import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHerdrCoreBackend, shellEscape } from '../pi-extension/subagents/herdr-core.mjs';

// Mock herdr-core (`hc`) + `herdr-app do` environment. Mirrors herdr.test.mjs but
// models the hc CLI: `run` returns {address}, `read` returns screen text, and
// `terminal.keep` visibility is a best-effort `herdr-app do` call.
function fixture(overrides = {}) {
  const calls = [];
  const appCalls = [];
  let next = 10;
  const env = { HC_TERMINAL_ID: 't2', HC_TERMINAL_SOCKET: '/run/user/1000/herdr-core/default.sock' };
  const run = args => {
    calls.push(args);
    if (args[0] === 'get' || args[0] === 'keep') return JSON.stringify({ state: 'live' });
    if (args[0] === 'run') return JSON.stringify({ address: `t${next++}`, agent: 'zsh', state: 'live', parent: 't2' });
    if (args[0] === 'kill') return JSON.stringify({ state: 'finished', reason: 'killed' });
    if (args[0] === 'rm') return JSON.stringify({ removed: true });
    if (args[0] === 'send') return JSON.stringify({ status: null, turn: 0 });
    return 'mock screen\n';
  };
  const appDo = args => { appCalls.push(args); return ''; };
  const backend = createHerdrCoreBackend({ env, run, runAsync: async args => run(args), appDo, ...overrides });
  return { backend, env, calls, appCalls };
}

for (const field of ['HC_TERMINAL_ID', 'HC_TERMINAL_SOCKET']) {
  test(`no hc call without ${field}`, () => {
    const f = fixture(); delete f.env[field];
    assert.equal(f.backend.isMuxAvailable(), false);
    assert.throws(() => f.backend.createSurface('test'), /Herdr app|herdr-core/);
    assert.equal(f.calls.length, 0);
  });
}
test('HERDR_ENV (CLI) suppresses the app backend', () => {
  const f = fixture(); f.env.HERDR_ENV = '1';
  assert.equal(f.backend.isMuxAvailable(), false);
  assert.throws(() => f.backend.createSurface('test'), /Herdr app|herdr-core/);
});
test('no silent fallback when hc is unavailable', () => {
  const f = fixture({ run: () => { throw new Error('missing executable'); } });
  assert.equal(f.backend.isMuxAvailable(), false);
});
test('createSurface starts a child shell with cwd and returns its address', async () => {
  const f = fixture();
  const t = f.backend.createSurface('scout', '/tmp/path with spaces');
  assert.match(t, /^t\d+$/);
  // `hc run --bg --name <sanitized> --cwd <cwd> --no-notify`
  const args = f.calls[0];
  const nameIdx = args.indexOf('--name');
  assert.equal(args[0], 'run');
  assert.equal(args[1], '--bg');
  assert.match(args[nameIdx + 1], /^sub-scout-[a-f0-9]{12}$/);
  assert.equal(args[args.indexOf('--cwd') + 1], '/tmp/path with spaces');
  assert.ok(args.includes('--no-notify'));
  assert.equal(args[args.indexOf('--parent') + 1], f.env.HC_TERMINAL_ID);
  assert.ok(args.includes('--json'));
  await f.backend.showSurface(t);
  // Best-effort visibility: herdr-app do terminal.keep --terminal <t> --place right
  assert.deepEqual(f.appCalls[0], ['terminal.keep', '--terminal', t, '--place', 'right']);
});
test('visibility retries while the app discovers the new terminal', async () => {
  let attempts = 0;
  const f = fixture({ appDo: () => {
    if (++attempts === 1) throw Object.assign(new Error(), { stdout: '{"error":"no running terminal"}' });
  } });
  await f.backend.showSurface(f.backend.createSurface('scout', '/tmp'));
  assert.equal(attempts, 2);
});
test('an unavailable window leaves the child runnable after one attempt', async () => {
  let attempts = 0;
  const f = fixture({ appDo: () => { attempts++; throw new Error('no window'); } });
  const terminal = f.backend.createSurface('scout', '/tmp');
  await f.backend.showSurface(terminal);
  assert.equal(attempts, 1);
  assert.doesNotThrow(() => f.backend.sendCommand(terminal, 'echo hello'));
});
test('spawn names are unique even for the same display name', () => {
  const f = fixture();
  const a = f.backend.createSurface('scout', '/tmp');
  const b = f.backend.createSurface('scout', '/tmp');
  assert.notEqual(a, b);
  const names = f.calls.filter(c => c[0] === 'run').map(c => c[c.indexOf('--name') + 1]);
  assert.equal(new Set(names).size, names.length);
});
for (const terminal of ['t2', 't99', '']) {
  test(`refuses controlling unowned target ${JSON.stringify(terminal)}`, () => {
    const f = fixture();
    for (const fn of [() => f.backend.closeSurface(terminal), () => f.backend.sendCommand(terminal, 'hello'), () => f.backend.readScreen(terminal)]) assert.throws(fn, /not created/);
  });
}
test('sendCommand uses hc send --force with the text as one literal argv', () => {
  const f = fixture(), t = f.backend.createSurface('test');
  const text = "hello '$HOME'; $(not-executed)";
  f.backend.sendCommand(t, text);
  assert.deepEqual(f.calls.at(-1), ['send', '--force', '--json', '--', t, text]);
});
test('bounded reads use hc read --lines', () => {
  const f = fixture(), t = f.backend.createSurface('test');
  f.backend.readScreen(t, 100000);
  assert.deepEqual(f.calls.at(-1), ['read', t, '--lines', '400']);
  f.backend.readScreen(t, -1);
  assert.deepEqual(f.calls.at(-1), ['read', t, '--lines', '0']);
});
test('closeSurface kills then removes, and the target is no longer controllable', () => {
  const f = fixture(), t = f.backend.createSurface('test');
  f.backend.closeSurface(t);
  assert.deepEqual(f.calls.at(-3), ['keep', t, '--off']);
  assert.deepEqual(f.calls.at(-2), ['kill', t]);
  assert.deepEqual(f.calls.at(-1), ['rm', t]);
  assert.throws(() => f.backend.sendCommand(t, 'hello'), /not created/);
  assert.throws(() => f.backend.closeSurface(t), /not created/);
});
test('errors never echo command text or CLI stderr', () => {
  let fail = false;
  const f = fixture({ run: args => {
    if (fail && args[0] === 'send') throw new Error('secret-token + ' + args.join(' '));
    return args[0] === 'run' ? JSON.stringify({ address: 't99', state: 'live' }) : '{}';
  }});
  const t = f.backend.createSurface('test'); fail = true;
  assert.throws(() => f.backend.sendCommand(t, 'secret-token'), e => !e.message.includes('secret-token'));
});
for (const code of [0, 7, 127]) {
  test(`private launcher records real exit status ${code}, not screen text`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'herdr-core-adapter-test-'));
    try {
      const f = fixture(), t = f.backend.createSurface('test');
      const path = join(dir, "launch 'quoted'.sh"), injected = join(dir, 'must-not-exist');
      f.backend.sendLongCommand(t, `bash -c 'exit ${code}'; echo '__SUBAGENT_DONE_'$?'__'`, {
        scriptPath: path, scriptPreamble: `name\ntouch ${shellEscape(injected)}`,
      });
      assert.equal(statSync(path).mode & 0o777, 0o600);
      try { execFileSync('bash', [path]); } catch (error) { assert.equal(error.status, code); }
      assert.throws(() => statSync(injected), /ENOENT/);
      assert.equal(readFileSync(path + '.done', 'utf8').trim(), String(code));
      const result = await f.backend.pollForExit(t, new AbortController().signal, { interval: 10 });
      assert.equal(result.exitCode, code);
      assert.equal(result.reason, 'sentinel');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
test('will not overwrite an existing script/symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'herdr-core-adapter-test-'));
  try {
    const target = join(dir, 'target'), path = join(dir, 'launch.sh');
    writeFileSync(target, 'untouched'); symlinkSync(target, path);
    const f = fixture(), t = f.backend.createSurface('test');
    assert.throws(() => f.backend.sendLongCommand(t, "true; echo '__SUBAGENT_DONE_'$?'__'", {scriptPath: path}), /EEXIST/);
    assert.equal(readFileSync(target, 'utf8'), 'untouched');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('unsupported launch trailer fails before any script execution', () => {
  const f = fixture(), t = f.backend.createSurface('test');
  const dir = mkdtempSync(join(tmpdir(), 'herdr-core-adapter-test-'));
  try { assert.throws(() => f.backend.sendLongCommand(t, 'echo hello', {scriptPath: join(dir,'launch.sh')}), /exit-status trailer/); }
  finally { rmSync(dir, {recursive:true,force:true}); }
});
test('provider error sidecar is bounded and reported as failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'herdr-core-adapter-test-'));
  try {
    const sessionFile = join(dir,'child.jsonl');
    writeFileSync(sessionFile+'.exit', JSON.stringify({type:'error',errorMessage:'e'.repeat(4000)}));
    const f = fixture(), t = f.backend.createSurface('test');
    const result = await f.backend.pollForExit(t, new AbortController().signal, {sessionFile,interval:10});
    assert.equal(result.exitCode,1); assert.equal(result.errorMessage.length,2048);
    assert.throws(() => statSync(sessionFile+'.exit'), /ENOENT/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('three failed terminal queries terminate instead of polling forever', async () => {
  const f = fixture({runAsync: async () => {throw new Error('gone');}}), t=f.backend.createSurface('test');
  const result = await f.backend.pollForExit(t,new AbortController().signal,{interval:10});
  assert.equal(result.exitCode,1); assert.match(result.errorMessage,/unconfirmed/);
});
test('a finished terminal without a sidecar reports failure', async () => {
  const f = fixture({ runAsync: async () => JSON.stringify({ state: 'finished' }) });
  const terminal = f.backend.createSurface('test');
  const result = await f.backend.pollForExit(terminal, new AbortController().signal, { interval: 10 });
  assert.equal(result.exitCode, 1);
  assert.match(result.errorMessage, /before reporting completion/);
});
test('cancellation stops polling a live terminal', async () => {
  const f=fixture({runAsync:async()=> JSON.stringify({ state: 'live' })}), t=f.backend.createSurface('test');
  const controller=new AbortController();
  const promise=f.backend.pollForExit(t,controller.signal,{interval:10});
  setTimeout(()=>controller.abort(),35);
  await assert.rejects(promise,e=>e.name==='AbortError');
});
test('already-aborted polls perform no reads', async () => {
  const f=fixture(), t=f.backend.createSurface('test'), c=new AbortController(); c.abort();
  await assert.rejects(f.backend.pollForExit(t,c.signal,{interval:10}),e=>e.name==='AbortError');
});
test('shell escaping preserves literal special characters', () => {
  const input="a ' $HOME `literal` \n b";
  assert.equal(execFileSync('bash',['-c',`printf %s ${shellEscape(input)}`],{encoding:'utf8'}),input);
  assert.throws(()=>shellEscape('bad\0argument'),/Invalid/);
});
