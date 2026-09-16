// Readiness regressions. Intentionally red against the unmodified upstream
// implementation: reproduce failures using ONLY disposable synthetic data.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerConsolidatorTools } from '../agent/consolidator/tools.js';
import { registerCompactionHook } from '../src/hooks/compaction-hook.js';
import { evaluateConsolidatorTrigger } from '../src/hooks/consolidator-trigger.js';
import { Runtime } from '../src/runtime.js';
import * as launch from '../src/spawn/launch.js';
import observationalMemory from '../src/index.js';
import { observation, observationsRecordedEntry, rawMessage, OM_OBSERVATIONS_DROPPED } from './fixtures/session.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'pi-om-safety-')); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
function belt(memory: string) {
  const tools = new Map<string, any>();
  registerConsolidatorTools({ registerTool: (tool: any) => tools.set(tool.name, tool) } as any, memory);
  return tools;
}
function runtime(memory: string) {
  const r = new Runtime(); r.enabled = true; r.configLoaded = true; r.memoryRoot = memory;
  r.config = { ...r.config, passive: false };
  return r;
}

it('rejects reading a symlink that escapes the memory directory', async () => {
  const memory = join(root, 'memory'); mkdirSync(memory);
  const outside = join(root, 'outside.md'); writeFileSync(outside, 'SYNTHETIC_OUTSIDE_CONTENT');
  symlinkSync(outside, join(memory, 'alias.md'));
  const result = await belt(memory).get('read').execute('fixture', { path: 'alias.md' });
  expect(result.content[0].text.includes('SYNTHETIC_OUTSIDE_CONTENT')).toBe(false);
});

it('rejects writes through a directory symlink outside memory', async () => {
  const memory = join(root, 'memory'), outside = join(root, 'outside');
  mkdirSync(memory); mkdirSync(outside); symlinkSync(outside, join(memory, 'alias'));
  await belt(memory).get('write').execute('fixture', { path: 'alias/escaped.md', content: 'synthetic' });
  expect(existsSync(join(outside, 'escaped.md'))).toBe(false);
});

it('does not replace unobserved history with an empty compaction summary', async () => {
  const memory = join(root, 'memory'); mkdirSync(memory);
  const r = runtime(memory), handlers = new Map<string, any>();
  registerCompactionHook({ on: (name: string, fn: any) => handlers.set(name, fn) } as any, r);
  const branch = [rawMessage('early', 'Important synthetic requirement.'), rawMessage('recent', 'New task.')];
  const ctx = { cwd: root, hasUI: false, sessionManager: { getBranch: () => branch } };
  const result = await handlers.get('session_before_compact')({
    branchEntries: branch, preparation: { firstKeptEntryId: 'recent', tokensBefore: 100 },
    signal: new AbortController().signal,
  }, ctx);
  expect(result?.compaction).toBeUndefined(); // fall back to Pi, or cancel; do not discard the requirement
});

it('does not tombstone observations when a zero-exit consolidator writes no memory', async () => {
  vi.spyOn(launch, 'spawnWorker').mockResolvedValue({ code: 0, signal: null, stderr: '' });
  const r = runtime(join(root, 'memory'));
  r.config.poolTargetTokens = 1; r.config.consolidateAtPoolTokens = 2;
  const branch = [rawMessage('raw', 'synthetic source'), observationsRecordedEntry('obs', {
    observations: [observation('2026-05-02T10:00:01'), observation('2026-05-02T10:00:02')], coversUpToId: 'raw',
  })];
  const appended: string[] = [];
  const pi = { appendEntry: (type: string) => appended.push(type) } as any;
  const ctx = { hasUI: false, sessionManager: { getBranch: () => branch, getEntries: () => branch } };
  evaluateConsolidatorTrigger(pi, r, ctx);
  await vi.waitFor(() => expect(r.consolidatorInFlight).toBe(false));
  expect(appended.includes(OM_OBSERVATIONS_DROPPED)).toBe(false);
});

it('bounds worker stderr rather than accumulating it without limit', async () => {
  const result = await launch.spawnWorker({
    argv: [process.execPath, '-e', "process.stderr.write('e'.repeat(1024*1024))"],
    cwd: root, env: process.env,
  });
  expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(64 * 1024);
});

it('escalates cancellation when a worker ignores SIGTERM', async () => {
  const pidPath = join(root, 'owned-child.pid');
  const script = `process.on('SIGTERM',()=>{}); require('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid)); setInterval(()=>{},1000);`;
  const controller = new AbortController();
  const pending = launch.spawnWorker({ argv: [process.execPath, '-e', script], cwd: root, env: process.env, signal: controller.signal });
  let pid: number | undefined;
  let terminated = false;
  try {
    await vi.waitFor(() => expect(existsSync(pidPath)).toBe(true));
    pid = Number(readFileSync(pidPath, 'utf8'));
    controller.abort();
    terminated = await Promise.race([pending.then(() => true), sleep(4200).then(() => false)]);
  } finally {
    // Only the PID written by our just-created synthetic child is touched.
    // This cleanup prevents the failing upstream cancellation test leaving it alive.
    if (pid && !terminated) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    else controller.abort();
    await pending;
  }
  expect(terminated).toBe(true);
}, 10000);

it('stays inert and creates no memory while disabled by default', async () => {
  const spawn = vi.spyOn(launch, 'spawnWorker');
  vi.stubEnv('PI_CODING_AGENT_DIR', join(root, 'config'));
  const handlers = new Map<string, any[]>();
  const pi = {
    on(name: string, fn: any) { const list=handlers.get(name)??[]; list.push(fn); handlers.set(name,list); },
    registerCommand() {}, appendEntry() { throw new Error('Unexpected session write'); },
  } as any;
  observationalMemory(pi);
  const branch = [rawMessage('raw','synthetic source')];
  const ctx = {cwd:root,hasUI:false,sessionManager:{getBranch:()=>branch,getEntries:()=>branch,getSessionId:()=> 'fixture'}};
  for(const event of ['session_start','agent_start','turn_end','session_before_compact','session_shutdown']) {
    for(const fn of handlers.get(event)??[]) await fn({},ctx);
  }
  expect(spawn).not.toHaveBeenCalled();
  expect(existsSync(join(root,'.memory'))).toBe(false);
});
