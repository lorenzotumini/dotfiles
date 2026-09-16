import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { parentProfile } from '../src/parent-profile.js';
import memory from '../src/index.js';
import * as launch from '../src/spawn/launch.js';
const model = {provider:'fixture',id:'parent-model',contextWindow:128_000};
const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
it('uses the parent provider/model/thinking for both workers',()=>{
  const c=parentProfile(model,'high');
  expect(c.models.observer).toEqual({provider:'fixture',id:'parent-model',thinking:'high'});
  expect(c.models.consolidator).toEqual(c.models.observer);
  expect(c.observerConcurrency).toBe(1);expect(c.debugLog).toBe(false);
});
it('scales conservative budgets for a smaller context',()=>{
  const c=parentProfile({...model,contextWindow:16_384});
  expect(c.chunkTokens).toBe(1024);expect(c.compactAtContextTokens).toBeLessThan(16_384);
  expect(c.tailTokens+c.consolidateAtPoolTokens+c.journeyTargetTokens).toBeLessThan(c.compactAtContextTokens);
});
it('refuses missing or inadequately sized parent models rather than picking another provider',()=>{
  expect(()=>parentProfile(undefined)).toThrow();
  expect(()=>parentProfile({...model,contextWindow:8192})).toThrow();
});
it('defaults off, follows model changes, and overrides project worker settings',async()=>{
  const root=mkdtempSync(join(tmpdir(),'om-parent-profile-'));roots.push(root);
  vi.stubEnv('PI_CODING_AGENT_DIR',join(root,'config'));
  mkdirSync(join(root,'.pi'));
  writeFileSync(join(root,'.pi/settings.json'),JSON.stringify({'observational-memory':{models:{observer:{provider:'unwanted',id:'wrong'}},observerConcurrency:100,debugLog:true}}));
  const spawn=vi.spyOn(launch,'spawnWorker');
  const hooks=new Map<string,any[]>(),commands=new Map<string,any>(),branch:any[]=[],notices:string[]=[];
  let runtime:any;
  const pi={on(n:string,h:any){const a=hooks.get(n)??[];a.push(h);hooks.set(n,a)},registerCommand:(n:string,c:any)=>commands.set(n,c),appendEntry:(customType:string,data:any)=>branch.push({type:'custom',customType,data})} as any;
  memory(pi,{configure(r,ctx){runtime=r;r.config=parentProfile(ctx.model,'low');r.configLoaded=true;}});
  const ctx:any={cwd:root,hasUI:true,ui:{notify:(t:string)=>notices.push(t)},model,
    sessionManager:{getBranch:()=>branch,getEntries:()=>branch,getSessionId:()=> 'fixture'}};
  const emit=async(n:string)=>{for(const h of hooks.get(n)??[])await h({},ctx)};
  await emit('session_start');await emit('agent_start');
  expect(runtime).toBeUndefined();expect(branch).toEqual([]);expect(existsSync(join(root,'.memory'))).toBe(false);
  await commands.get('om').handler('on',ctx);
  expect(runtime.enabled).toBe(true);expect(runtime.config.models.observer.provider).toBe('fixture');
  expect(runtime.config.observerConcurrency).toBe(1);expect(runtime.config.debugLog).toBe(false);
  ctx.model={...model,provider:'another-fixture',id:'new-parent'};await emit('model_select');
  expect(runtime.config.models.consolidator.id).toBe('new-parent');
  await commands.get('om:status').handler('',ctx);expect(notices.at(-1)).toContain('another-fixture/new-parent');
  await commands.get('om').handler('off',ctx);expect(runtime.enabled).toBe(false);
  expect(spawn).not.toHaveBeenCalled();await emit('session_shutdown');
});
it('fails closed on enable if the parent model is unavailable',async()=>{
  const root=mkdtempSync(join(tmpdir(),'om-parent-missing-'));roots.push(root);
  const hooks=new Map<string,any[]>(),commands=new Map<string,any>();let runtime:any;
  const pi={on(n:string,h:any){const a=hooks.get(n)??[];a.push(h);hooks.set(n,a)},registerCommand:(n:string,c:any)=>commands.set(n,c),appendEntry(){throw new Error('must not persist enablement')}} as any;
  memory(pi,{configure(r,ctx){runtime=r;r.config=parentProfile(ctx.model);}});
  await expect(commands.get('om').handler('on',{cwd:root,hasUI:false})).rejects.toThrow(/selected parent model/);
  expect(runtime.enabled).toBe(false);expect(existsSync(join(root,'.memory'))).toBe(false);
});
