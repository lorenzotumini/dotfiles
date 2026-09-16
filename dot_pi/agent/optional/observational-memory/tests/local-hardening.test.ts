import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerConsolidatorTools } from '../agent/consolidator/tools.js';
import { Runtime } from '../src/runtime.js';
import { atomicWrite, resolveWithinMemory } from '../src/memory/paths.js';
import { contiguousCoverageMarker, hasCompleteCoverage } from '../src/ledger/coverage.js';
import { registerCompactionHook } from '../src/hooks/compaction-hook.js';
import { evaluateObserverTriggers } from '../src/hooks/observer-trigger.js';
import { evaluateConsolidatorTrigger } from '../src/hooks/consolidator-trigger.js';
import * as launch from '../src/spawn/launch.js';
import { writeObserverResult } from '../src/spawn/runs.js';
import { topicDigest, verifyConsolidationReceipt, writeConsolidationReceipt } from '../src/spawn/receipt.js';
import { observation, observationsRecordedEntry, rawMessage, OM_OBSERVATIONS_DROPPED, OM_OBSERVATIONS_RECORDED } from './fixtures/session.js';

let root:string;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'pi-om-hardening-'));});
afterEach(()=>{vi.restoreAllMocks();rmSync(root,{recursive:true,force:true});});
const obs=()=>observation('2026-05-02T10:00:01',{content:'A synthetic requirement.'});
function recorded(id:string, ids:string[], observations=[obs()]) {
  const entry=observationsRecordedEntry(id,{observations,coversUpToId:ids.at(-1)!});
  entry.data={...(entry.data as object),sourceEntryIds:ids};return entry;
}
function setup() {
  const r=new Runtime();r.enabled=true;r.configLoaded=true;r.memoryRoot=join(root,'memory');
  r.config={...r.config,passive:false,chunkTokens:20,observerConcurrency:2,poolTargetTokens:1,consolidateAtPoolTokens:2};
  const branch:any[]=[rawMessage('one','a'.repeat(100)),rawMessage('two','b'.repeat(100))];
  const appended:any[]=[];
  const pi={appendEntry:(customType:string,data:any)=>{const e={type:'custom',customType,id:'new-'+appended.length,data};appended.push(e);branch.push(e)}} as any;
  const ctx={cwd:root,hasUI:false,sessionManager:{getBranch:()=>branch,getEntries:()=>branch}};
  return {r,branch,appended,pi,ctx};
}
function tools(memory:string,result?:string) {
  const map=new Map<string,any>();registerConsolidatorTools({registerTool:(t:any)=>map.set(t.name,t)} as any,memory,result);return map;
}

it('rejects symlink-backed roots and hidden worker IPC access',async()=>{
  const outside=join(root,'outside');mkdirSync(outside);symlinkSync(outside,join(root,'alias'));
  expect(resolveWithinMemory(join(root,'alias','memory'),'auth.md')).toBeUndefined();
  const memory=join(root,'memory');mkdirSync(join(memory,'.runs'),{recursive:true});
  writeFileSync(join(memory,'.runs','private.md'),'synthetic IPC');
  const result=await tools(memory).get('read').execute('id',{path:'.runs/private.md'});
  expect(result.details.error).toBe(true);
});
it('creates private files and directories without changing the process umask',()=>{
  const original=process.umask();
  const file=join(root,'new','topic.md');atomicWrite(file,'synthetic');
  expect(statSync(file).mode&0o777).toBe(0o600);
  expect(statSync(join(root,'new')).mode&0o777).toBe(0o700);
  expect(process.umask()).toBe(original);
});
it('does not infer complete coverage from a later successful chunk',()=>{
  const branch=[rawMessage('one','first'),rawMessage('two','second'),rawMessage('tail','current'),recorded('later',['two'])];
  expect(contiguousCoverageMarker(branch)).toBeUndefined();expect(hasCompleteCoverage(branch,'tail')).toBe(false);
  branch.push(recorded('earlier',['one']));
  expect(contiguousCoverageMarker(branch)).toBe('two');expect(hasCompleteCoverage(branch,'tail')).toBe(true);
});
it('accepts explicit empty-chunk coverage but not an unproven legacy endpoint',()=>{
  const branch=[rawMessage('one','no facts'),rawMessage('tail','current'),recorded('empty',['one'],[])];
  expect(hasCompleteCoverage(branch,'tail')).toBe(true);
  (branch.at(-1)!.data as any).sourceEntryIds=undefined;
  expect(hasCompleteCoverage(branch,'tail')).toBe(false);
});
it('does not use a chunk that crosses the compaction cutoff as summary coverage',()=>{
  const branch=[rawMessage('one','first'),rawMessage('two','current'),recorded('both',['one','two'])];
  expect(hasCompleteCoverage(branch,'two')).toBe(false);
});
it('compacts fully covered history and honors cancellation',async()=>{
  const s=setup();s.branch.splice(1,0,recorded('observed',['one']));
  const hooks=new Map<string,any>();registerCompactionHook({on:(n:string,f:any)=>hooks.set(n,f)} as any,s.r);
  const event={preparation:{firstKeptEntryId:'two',tokensBefore:100},branchEntries:s.branch,signal:new AbortController().signal};
  const result=await hooks.get('session_before_compact')(event,s.ctx);
  expect(result.compaction.summary).toContain('synthetic requirement');expect(result.compaction.firstKeptEntryId).toBe('two');
  const controller=new AbortController();controller.abort();
  expect(await hooks.get('session_before_compact')({...event,signal:controller.signal},s.ctx)).toEqual({cancel:true});
});
it('retries an early failed slice instead of advancing past a coverage hole',async()=>{
  const s=setup();let calls=0;
  vi.spyOn(launch,'spawnWorker').mockImplementation(async opts=>{
    calls++;
    if(calls===1)return {code:1,signal:null,stderr:'synthetic failure'};
    atomicWrite(opts.env.OM_STATUS_PATH!,JSON.stringify({ok:true}));
    writeObserverResult(opts.env.OM_RESULT_PATH!,{observations:[{timestamp:'2026-06-25 14:30',content:'Synthetic observation '+calls}]});
    return {code:0,signal:null,stderr:''};
  });
  evaluateObserverTriggers(s.pi,s.r,s.ctx);await s.r.whenObserversIdle();
  expect(calls).toBe(2);expect(s.appended.filter(e=>e.customType===OM_OBSERVATIONS_RECORDED).map(e=>e.data.sourceEntryIds)).toEqual([['two']]);
  evaluateObserverTriggers(s.pi,s.r,s.ctx);await s.r.whenObserversIdle();
  expect(calls).toBe(3);expect(contiguousCoverageMarker(s.branch)).toBe('two');
});
it('does not commit output from a worker invalidated by disable/navigation',async()=>{
  const s=setup();s.r.config.observerConcurrency=1;
  let finish!:(value:launch.WorkerExit)=>void;
  vi.spyOn(launch,'spawnWorker').mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
  evaluateObserverTriggers(s.pi,s.r,s.ctx);s.r.abortAllWorkers();
  finish({code:0,signal:null,stderr:''});await s.r.whenObserversIdle();
  expect(s.appended).toEqual([]);
});
it('does not treat an untouched observer result file as successful observation',async()=>{
  const s=setup();s.r.config.observerConcurrency=1;
  vi.spyOn(launch,'spawnWorker').mockImplementation(async opts=>{
    atomicWrite(opts.env.OM_STATUS_PATH!,JSON.stringify({ok:true}));
    writeObserverResult(opts.env.OM_RESULT_PATH!,{observations:[],recorded:false});
    return {code:0,signal:null,stderr:''};
  });
  evaluateObserverTriggers(s.pi,s.r,s.ctx);await s.r.whenObserversIdle();
  expect(s.appended).toEqual([]);expect(s.r.lastWorkerError).toContain('never called');
});
it('requires an explicit receipt even after a successful consolidator assistant turn',async()=>{
  const s=setup();s.branch.push(recorded('obs',['one','two']));
  vi.spyOn(launch,'spawnWorker').mockImplementation(async opts=>{
    atomicWrite(opts.env.OM_STATUS_PATH!,JSON.stringify({ok:true}));
    return {code:0,signal:null,stderr:''};
  });
  evaluateConsolidatorTrigger(s.pi,s.r,s.ctx);await s.r.whenWorkersIdle();
  expect(s.appended.some(e=>e.customType===OM_OBSERVATIONS_DROPPED)).toBe(false);
});
it('tombstones only acknowledged IDs backed by a durable-file receipt',async()=>{
  const s=setup();const second=observation('2026-05-02T10:00:02');
  s.branch.push(recorded('obs',['one','two'],[obs(),second]));
  vi.spyOn(launch,'spawnWorker').mockImplementation(async opts=>{
    const belt=tools(s.r.memoryRoot,opts.env.OM_RESULT_PATH);
    await belt.get('write').execute('id',{path:'auth.md',content:'---\nid: auth\nsummary: Synthetic memory\n---\nA synthetic requirement.'});
    const result=await belt.get('finish_consolidation').execute('id',{observationTimestamps:[obs().timestamp],files:['auth.md']});
    expect(result.details.error).not.toBe(true);
    atomicWrite(opts.env.OM_STATUS_PATH!,JSON.stringify({ok:true}));
    return {code:0,signal:null,stderr:''};
  });
  evaluateConsolidatorTrigger(s.pi,s.r,s.ctx);await s.r.whenWorkersIdle();
  const dropped=s.appended.find(e=>e.customType===OM_OBSERVATIONS_DROPPED);
  expect(dropped.data.observationTimestamps).toEqual([obs().timestamp]);
  expect(existsSync(join(s.r.memoryRoot,'INDEX.md'))).toBe(true);
});
it('rejects stale file hashes and foreign observation IDs',()=>{
  const memory=join(root,'memory'),path=join(root,'receipt.json');
  atomicWrite(join(memory,'auth.md'),'synthetic durable fact');
  writeConsolidationReceipt(path,{observationTimestamps:['known'],files:[{path:'auth.md',sha256:topicDigest(memory,'auth.md')}]});
  expect(verifyConsolidationReceipt(memory,path,new Set(['known']))).toEqual(['known']);
  expect(()=>verifyConsolidationReceipt(memory,path,new Set(['other']))).toThrow();
  atomicWrite(join(memory,'auth.md'),'changed after receipt');
  expect(()=>verifyConsolidationReceipt(memory,path,new Set(['known']))).toThrow();
});
it('finish_consolidation cannot acknowledge a topic it never wrote',async()=>{
  const memory=join(root,'memory'),result=join(root,'receipt.json');
  atomicWrite(join(memory,'auth.md'),'old topic');
  const response=await tools(memory,result).get('finish_consolidation').execute('id',{observationTimestamps:['known'],files:['auth.md']});
  expect(response.details.error).toBe(true);expect(existsSync(result)).toBe(false);
});
it('read output is bounded and can continue by line offset',async()=>{
  const memory=join(root,'memory');atomicWrite(join(memory,'large.md'),Array.from({length:600},(_,i)=>`${i}: `+'a'.repeat(40)).join('\n'));
  const belt=tools(memory);
  const first=await belt.get('read').execute('id',{path:'large.md'});
  expect(Buffer.byteLength(first.content[0].text)).toBeLessThanOrEqual(16*1024);
  expect(first.content[0].text).toContain('offset 201');
  const next=await belt.get('read').execute('id',{path:'large.md',offset:201,limit:1});
  expect(next.content[0].text).toContain('200:');
});
