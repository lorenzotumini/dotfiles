// Offline lifecycle tests: real extension + real bash launch scripts, but fake
// Herdr and fake Pi executables. No live panes, credentials, or model requests.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { jiti, loadExtensions } from './local-loader.mjs';

const root = mkdtempSync(join(tmpdir(), 'pi-herdr-lifecycle-'));
const entry = fileURLToPath(new URL('../pi-extension/subagents/index.ts', import.meta.url));
const oldEnv = { ...process.env };
let shutdown = () => {};
let count = 0;
async function check(name, fn) { await fn(); console.log(`ok ${++count} - ${name}`); }
async function until(predicate, label) {
  const end = Date.now() + 6000;
  while (!predicate()) { if (Date.now() > end) throw new Error(`Timed out: ${label}`); await sleep(30); }
}
try {
  const bin=join(root,'bin'), config=join(root,'agent'), project=join(root,'project');
  for (const d of [bin,config,project]) mkdirSync(d);
  Object.assign(process.env, {
    PATH:bin+':'+oldEnv.PATH, PI_OFFLINE:'1', PI_CODING_AGENT_DIR:config,
    HERDR_ENV:'1', HERDR_PANE_ID:'w9:p1', HERDR_SOCKET_PATH:join(root,'not-a-real-socket'),
    PI_SUBAGENT_HERDR_TRIAL:'1', PI_SUBAGENT_MUX:'herdr', PI_SUBAGENT_ALLOWED:'trial-scout',
    PI_SUBAGENT_SHELL_READY_DELAY_MS:'0', HERDR_MOCK_ROOT:root,
  });
  delete process.env.PI_SUBAGENT_AGENT;
  writeFileSync(join(bin,'herdr'), `#!/usr/bin/env node
const fs=require('node:fs'),p=require('node:path');
const r=process.env.HERDR_MOCK_ROOT,a=process.argv.slice(2),log=p.join(r,'herdr.log');
fs.appendFileSync(log,JSON.stringify(a)+'\\n');
if(a[0]==='--version'){console.log('mock herdr');process.exit(0)}
if(a[1]==='split'){
 const f=p.join(r,'next-pane'); let n=fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):1; fs.writeFileSync(f,String(++n));
 console.log(JSON.stringify({result:{pane:{pane_id:'w9:p'+n}}}));
}else if(a[1]==='read'){console.log('__SUBAGENT_DONE_0__ (not authoritative)')}
else if(a[1]==='run'||a[1]==='close'){console.log(JSON.stringify({result:{ok:true}}))}
else {console.error('Unexpected mock Herdr command');process.exit(2)}
`, {mode:0o700});
  writeFileSync(join(bin,'pi'), `#!/usr/bin/env node
const fs=require('node:fs'),p=require('node:path');
const r=process.env.HERDR_MOCK_ROOT,a=process.argv.slice(2);
fs.appendFileSync(p.join(r,'pi.log'),JSON.stringify({args:a,trial:process.env.PI_SUBAGENT_HERDR_TRIAL,subagentsDefault:process.env.PI_SUBAGENTS_DEFAULT,cwd:process.cwd()})+'\\n');
const i=a.indexOf('--session'); if(i<0)process.exit(0);
const f=a[i+1];
fs.appendFileSync(f,JSON.stringify({type:'message',id:'fixture-'+Date.now(),parentId:null,timestamp:new Date().toISOString(),message:{role:'assistant',content:[{type:'text',text:'FIXTURE RESULT '+ 'x'.repeat(20000)}],stopReason:'stop',model:'fixture-model',provider:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{total:0}}}})+'\\n');
`, {mode:0o700});
  const module=await jiti.import(entry);
  const tools=new Map(), handlers=new Map(), messages=[];
  const api={
    on(name,fn){const list=handlers.get(name)??[];list.push(fn);handlers.set(name,list)},
    registerTool(t){tools.set(t.name,t)}, registerCommand(){}, registerMessageRenderer(){},
    sendMessage(message){messages.push(message)}, sendUserMessage(){},
  };
  module.default(api);
  const sessionDir=join(root,'sessions'); mkdirSync(sessionDir);
  const parentSession=join(sessionDir,'parent.jsonl');
  writeFileSync(parentSession,JSON.stringify({type:'session',version:3,id:'fixture-parent',timestamp:new Date().toISOString(),cwd:project})+'\n');
  const ctx={cwd:project,model:{provider:'fixture',id:'fixture-model'},hasUI:false,
    sessionManager:{getSessionFile:()=>parentSession,getSessionId:()=> 'fixture-parent',getSessionDir:()=>sessionDir}};
  for(const fn of handlers.get('session_start')??[])await fn({},ctx);
  shutdown=()=>{for(const fn of handlers.get('session_shutdown')??[])fn({},ctx)};
  const invoke=(name,args,signal=new AbortController().signal)=>tools.get(name).execute('fixture-call',args,signal,undefined,ctx);
  const cliCalls=()=>readFileSync(join(root,'herdr.log'),'utf8').trim().split('\n').map(JSON.parse);
  const childCalls=()=>readFileSync(join(root,'pi.log'),'utf8').trim().split('\n').map(JSON.parse);

  await check('only the fixed read-only trial profile is discoverable',async()=>{
    const list=await invoke('subagents_list',{});
    assert.deepEqual(list.details.agents.map(a=>a.name),['trial-scout']);
    assert.ok(!('body' in list.details.agents[0]));
    const profile=module.__test__.loadAgentDefaults('trial-scout');
    assert.equal(profile.tools,'read, grep, find, ls');assert.equal(profile.subagentAgents,undefined);
  });
  await check('project agent definitions cannot override the trial profile',()=>{
    const original=process.cwd();
    const dir=join(project,'.pi','agents'); mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'trial-scout.md'),'---\nname: trial-scout\ntools: bash,write\n---\nWrong profile');
    try{process.chdir(project);assert.equal(module.__test__.loadAgentDefaults('trial-scout').tools,'read, grep, find, ls')}
    finally{process.chdir(original)}
  });
  await check('other agents and agentless launches are rejected before creating panes',async()=>{
    for(const agent of ['worker','scout','researcher',undefined]){
      const r=await invoke('subagent',{agent,task:'must not run'});assert.ok(r.details.error);
    }
    assert.ok(!existsSync(join(root,'herdr.log')));
  });
  await check('already-cancelled launches create no panes',async()=>{
    const c=new AbortController();c.abort();
    await assert.rejects(invoke('subagent',{agent:'trial-scout',task:'cancelled'},c.signal),/cancelled/);
    assert.ok(!cliCalls().some(a=>a[1]==='split'));
  });
  let started;
  await check('launch is asynchronous and snapshots parent model/cwd/read-only tools',async()=>{
    started=await invoke('subagent',{agent:'trial-scout',name:'Scout',task:'Inspect the fixture'});
    assert.equal(started.details.status,'started');
    const loadout=JSON.parse(readFileSync(started.details.sessionFile+'.loadout.json','utf8'));
    assert.equal(loadout.model,'fixture/fixture-model');assert.equal(loadout.cwd,project);
    assert.equal(loadout.toolAllowlist,'read,grep,find,ls,ask_question');
    assert.equal(loadout.spawnable,null);
    const script=readFileSync(started.details.launchScriptFile,'utf8');
    assert.match(script,/--no-skills/);assert.match(script,/--no-extensions/);
    assert.match(script,/--model 'fixture\/fixture-model'/);
    assert.equal(messages.length,0);
  });
  await check('a second scout cannot launch while one is active',async()=>{
    const r=await invoke('subagent',{agent:'trial-scout',name:'Other',task:'no'});
    assert.equal(r.details.error,'trial concurrency limit');
    assert.equal(cliCalls().filter(a=>a[1]==='split').length,1);
  });
  await check('question handoff and reply target the child, not the parent pane',async()=>{
    writeFileSync(started.details.sessionFile+'.ask',JSON.stringify({question:'Fixture clarification?'}));
    await until(()=>messages.some(m=>m.customType==='subagent_question'),'question delivery');
    const r=await invoke('subagent_message',{name:'Scout',message:'Proceed\nread-only'});
    assert.equal(r.details.status,'steered');
    const call=cliCalls().filter(a=>a[1]==='run').at(-1);
    assert.equal(call[2],'w9:p2');assert.equal(call[3],'Proceed read-only');
  });
  await check('real launch script + fake Pi deliver a bounded completion and close child',async()=>{
    execFileSync('bash',[started.details.launchScriptFile],{cwd:project,env:process.env});
    await until(()=>messages.some(m=>m.customType==='subagent_result'),'completion');
    const result=messages.find(m=>m.customType==='subagent_result');
    assert.match(result.content,/FIXTURE RESULT/);assert.match(result.content,/Truncated/);
    assert.ok(Buffer.byteLength(result.content)<=16384);assert.equal(result.details.exitCode,0);
    assert.ok(cliCalls().some(a=>a[1]==='close'&&a[2]==='w9:p2'));
    assert.equal(module.__test__.runningSubagents.size,0);
    assert.equal(childCalls()[0].cwd,project);
  });
  let resumed;
  await check('resume replays the same restricted model/tools/cwd',async()=>{
    resumed=await invoke('subagent_message',{name:'Scout',message:'Follow up on the fixture'});
    assert.equal(resumed.details.status,'started');
    execFileSync('bash',[resumed.details.launchScriptFile],{cwd:project,env:process.env});
    await until(()=>messages.filter(m=>m.customType==='subagent_result').length===2,'resume completion');
    const args=childCalls().at(-1).args;
    assert.equal(args[args.indexOf('--tools')+1],'read,grep,find,ls,ask_question');
    assert.equal(args[args.indexOf('--model')+1],'fixture/fixture-model');
    assert.ok(args.includes('--no-skills'));assert.ok(args.includes('--no-extensions'));
  });
  await check('widened resume snapshots are refused',async()=>{
    const path=started.details.sessionFile+'.loadout.json';
    const original=readFileSync(path,'utf8'), loadout=JSON.parse(original);
    loadout.toolAllowlist+='bash';writeFileSync(path,JSON.stringify(loadout));
    try{await assert.rejects(invoke('subagent_message',{name:'Scout',message:'no'}),/read-only/)}
    finally{writeFileSync(path,original)}
  });
  await check('shutdown cancels its child without sending stale completion turns',async()=>{
    const r=await invoke('subagent',{agent:'trial-scout',name:'Scout',task:'Wait for shutdown'});
    assert.equal(r.details.name,'Scout-2');
    const before=messages.filter(m=>m.customType==='subagent_result').length;
    shutdown();
    await until(()=>cliCalls().some(a=>a[1]==='close'&&a[2]==='w9:p4'),'shutdown cleanup');
    await sleep(100);
    assert.equal(messages.filter(m=>m.customType==='subagent_result').length,before);
    assert.equal(module.__test__.runningSubagents.size,0);
  });
  await check('standalone trial launcher has been removed',()=>{
    assert.equal(existsSync(resolve(process.env.HOME,'.local/bin/pi-subagents')),false);
  });
  await check('lean launcher grants toggleable subagents but defaults them off',()=>{
    const launcher=resolve(process.env.HOME,'.local/bin/pi-lean');
    execFileSync(launcher,['--model','fixture/model','prompt with spaces'],{env:{...process.env,HERDR_ENV:'0'}});
    const call=childCalls().at(-1);
    assert.equal(call.subagentsDefault,'off');assert.ok(call.args.includes('--no-extensions'));
    assert.equal(call.args[call.args.indexOf('--tools')+1],'read,bash,edit,write,subagent,subagent_message,subagents_list');
    assert.ok(call.args.some(a=>a.endsWith('/extensions/interactive-subagents/index.ts')));
    assert.deepEqual(call.args.slice(-3),['--model','fixture/model','prompt with spaces']);
  });
  await check('parent and child extensions load through installed Pi loader',async()=>{
    const parent=await loadExtensions([entry],project);assert.deepEqual(parent.errors,[]);
    assert.deepEqual([...parent.extensions[0].tools.keys()].sort(),['subagent','subagent_message','subagents_list']);
    const child=await loadExtensions([resolve(entry,'../subagent-done.ts')],project);
    assert.deepEqual(child.errors,[]);assert.deepEqual([...child.extensions[0].tools.keys()],['ask_question']);
  });
  console.log(`Passed ${count} offline lifecycle checks. No real Herdr panes or LLM calls.`);
} finally {
  shutdown(); await sleep(100);
  for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];
  Object.assign(process.env,oldEnv);
  rmSync(root,{recursive:true,force:true});
}
