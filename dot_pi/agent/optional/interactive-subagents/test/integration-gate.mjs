import assert from 'node:assert/strict';
import { jiti, loadExtensions } from './local-loader.mjs';
const entry = new URL('../../../extensions/interactive-subagents/index.ts', import.meta.url).pathname;
const {default: extension} = await jiti.import(entry);
const { assertSubagentModel, resolveSubagentModel } = await jiti.import(new URL('../pi-extension/subagents/model-policy.ts', import.meta.url).pathname);
const oldEnv={...process.env};
const names=['subagent','subagent_message','subagents_list'];
let checks=0;
function fixture({lean=false,herdr=true,app=false,excluded=false,mux}={}) {
  process.env.HERDR_ENV=herdr?'1':'0';
  process.env.HERDR_PANE_ID='w9:p1';process.env.HERDR_SOCKET_PATH='/unused-fixture.sock';
  delete process.env.HC_TERMINAL_ID;
  delete process.env.HC_TERMINAL_SOCKET;
  if(app){
    process.env.HC_TERMINAL_ID='t1';
    process.env.HC_TERMINAL_SOCKET='/unused-app.sock';
  }
  if(mux)process.env.PI_SUBAGENT_MUX=mux;else delete process.env.PI_SUBAGENT_MUX;
  if(lean)process.env.PI_SUBAGENTS_DEFAULT='off';else delete process.env.PI_SUBAGENTS_DEFAULT;
  const tools=new Map(),commands=new Map(),handlers=new Map(),notifications=[],branch=[];
  let active=['read','bash','edit','write','unrelated_tool',...names];
  const pi={registerTool:t=>tools.set(t.name,t),registerCommand:(n,c)=>commands.set(n,c),registerMessageRenderer(){},
    on(n,h){const a=handlers.get(n)??[];a.push(h);handlers.set(n,a)},
    getActiveTools:()=>active,getAllTools:()=>[...active.filter(n=>!names.includes(n)),...(excluded?[]:names)].map(name=>({name})),
    setActiveTools:n=>{active=n},appendEntry:(customType,data)=>branch.push({type:'custom',customType,data}),
    sendUserMessage(){throw new Error('Unexpected model prompt')},sendMessage(){throw new Error('Unexpected model turn')},
  };
  extension(pi);
  const ctx={hasUI:true,ui:{notify:(t,k)=>notifications.push({text:t,kind:k})},sessionManager:{getBranch:()=>branch}};
  async function emit(n){for(const h of handlers.get(n)??[])await h({},ctx)}
  const command=a=>commands.get('subagents').handler(a,ctx);
  const visible=()=>names.every(n=>active.includes(n));
  return {tools,commands,ctx,notifications,branch,emit,command,visible,active:()=>active};
}
async function check(name,fn){await fn();console.log(`ok ${++checks} - ${name}`)}
try {
  await check('main Pi automatically exposes subagents inside Herdr',async()=>{
    const f=fixture();await f.emit('session_start');assert.equal(f.visible(),true);
    assert.ok(f.active().includes('unrelated_tool'));await f.emit('session_shutdown');
  });
  await check('the desktop context exposes tools with auto-detection or an app mux alias',async()=>{
    for(const mux of [undefined,'hc','herdr-core','herdr','tmux']){
      const f=fixture({herdr:false,app:true,mux});await f.emit('session_start');
      assert.equal(f.visible(),mux!=='herdr'&&mux!=='tmux');await f.emit('session_shutdown');
    }
  });
  await check('lean hides tools until explicit activation, preserving core tools',async()=>{
    const f=fixture({lean:true});await f.emit('session_start');assert.equal(f.visible(),false);
    assert.ok(f.active().includes('read'));await f.command('');assert.equal(f.visible(),true);
    assert.deepEqual(f.branch.at(-1).data,{profile:'lean',on:true});
    await f.command('');assert.equal(f.visible(),false);await f.emit('session_shutdown');
  });
  await check('outside Herdr both profiles remain usable without subagent schemas',async()=>{
    for(const lean of [true,false]){
      const f=fixture({lean,herdr:false});await f.emit('session_start');assert.equal(f.visible(),false);
      await f.command('');assert.equal(f.visible(),false);assert.equal(f.branch.length,0);
      assert.ok(f.active().includes('bash'));await f.emit('session_shutdown');
    }
  });
  await check('disabled tool execution cannot bypass the visibility gate',async()=>{
    const f=fixture({lean:true});await f.emit('session_start');
    for(const name of names)assert.throws(()=>f.tools.get(name).execute('id',{},undefined,undefined,f.ctx),/off/);
    await f.commands.get('subagents:spawn').handler('scout do something',f.ctx);
    assert.match(f.notifications.at(-1).text,/off/);await f.emit('session_shutdown');
  });
  await check('reload restores manual enablement from the active branch',async()=>{
    const f=fixture({lean:true});await f.emit('session_start');await f.command('');
    await f.emit('session_start');assert.equal(f.visible(),true);await f.emit('session_shutdown');
  });
  await check('tree navigation restores branch-local gate state',async()=>{
    const f=fixture();await f.emit('session_start');await f.command('');assert.equal(f.visible(),false);
    f.branch.length=0;await f.emit('session_tree');assert.equal(f.visible(),true);await f.emit('session_shutdown');
  });
  await check('main-profile state does not automatically enable a lean session',async()=>{
    const f=fixture({lean:true});f.branch.push({type:'custom',customType:'herdr-subagents-enabled',data:{profile:'main',on:true}});
    await f.emit('session_start');assert.equal(f.visible(),false);await f.emit('session_shutdown');
  });
  await check('CLI tool exclusions are respected',async()=>{
    const f=fixture({excluded:true});await f.emit('session_start');assert.equal(f.visible(),false);
    await f.command('');assert.equal(f.visible(),false);assert.equal(f.branch.length,0);await f.emit('session_shutdown');
  });
  await check('status and malformed commands do not persist state or toggle',async()=>{
    const f=fixture({lean:true});await f.emit('session_start');
    for(const arg of ['status','bad'])await f.command(arg);
    assert.equal(f.branch.length,0);assert.equal(f.visible(),false);await f.emit('session_shutdown');
  });
  await check('Herdr model resolution honors overrides and refuses local inference',()=>{
    delete process.env.PI_SUBAGENT_MODEL;
    const hosted = {provider:'hosted',id:'fast',baseUrl:'https://provider.example'};
    const local = {provider:'llama.cpp',id:'big',baseUrl:'http://127.0.0.1:8080'};
    const loopback = {provider:'custom',id:'small',baseUrl:'http://localhost:8081/v1'};
    const modelRegistry = {getAll:()=>[hosted,local,loopback]};
    const localCtx = {model:local,modelRegistry};
    assert.equal(resolveSubagentModel({model:hosted},undefined,undefined,true),'hosted/fast');
    assert.throws(()=>assertSubagentModel(localCtx,resolveSubagentModel(localCtx,undefined,undefined,true)),/hosted model/);
    assert.throws(()=>assertSubagentModel({model:hosted,modelRegistry},'custom/small'),/hosted model/);
    assert.throws(()=>assertSubagentModel(localCtx,'unregistered/model'),/hosted model/);
    assert.doesNotThrow(()=>assertSubagentModel(localCtx,'hosted/fast'));
    process.env.PI_SUBAGENT_MODEL='hosted/fast';
    assert.equal(resolveSubagentModel(localCtx,undefined,undefined,true),'hosted/fast');
    assert.equal(resolveSubagentModel(localCtx,'other/override','other/profile',true),'other/override');
    assert.equal(resolveSubagentModel(localCtx,undefined,'other/profile',true),'other/profile');
  });
  await check('integrated entry loads with the installed Pi loader',async()=>{
    const result=await loadExtensions([entry],process.cwd());assert.deepEqual(result.errors,[]);
    assert.deepEqual([...result.extensions[0].tools.keys()].sort(),names.toSorted());
    assert.ok(result.extensions[0].commands.has('subagents'));
  });
  console.log(`Passed ${checks} integration gate checks; no live Herdr/API/model calls.`);
} finally {
  for(const k of Object.keys(process.env))if(!(k in oldEnv))delete process.env[k];
  Object.assign(process.env,oldEnv);
}
