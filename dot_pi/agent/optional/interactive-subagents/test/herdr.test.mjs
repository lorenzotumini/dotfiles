import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHerdrBackend, shellEscape } from '../pi-extension/subagents/herdr.mjs';
import { boundedText } from '../pi-extension/subagents/bounds.mjs';

function fixture(overrides = {}) {
  const calls = [];
  let next = 1;
  const env = { HERDR_ENV: '1', HERDR_PANE_ID: 'w9:p1', HERDR_SOCKET_PATH: '/unused/mock.sock' };
  const run = args => {
    calls.push(args);
    if (args[0] === '--version') return 'mock';
    if (args[1] === 'split') return JSON.stringify({ result: { pane: { pane_id: `w9:p${++next}` } } });
    return 'mock screen';
  };
  const backend = createHerdrBackend({ env, run, runAsync: async args => run(args), ...overrides });
  return { backend, env, calls };
}

for (const field of ['HERDR_ENV', 'HERDR_PANE_ID', 'HERDR_SOCKET_PATH']) {
  test(`no Herdr call without ${field}`, () => {
    const f = fixture(); delete f.env[field];
    assert.equal(f.backend.isMuxAvailable(), false);
    assert.throws(() => f.backend.createSurface('test'), /Herdr-managed/);
    assert.equal(f.calls.length, 0);
  });
}
test('no silent fallback when Herdr is unavailable', () => {
  const f = fixture({ run: () => { throw new Error('missing executable'); } });
  assert.equal(f.backend.isMuxAvailable(), false);
});
test('split explicitly targets caller and preserves cwd/focus', () => {
  const f = fixture();
  assert.equal(f.backend.createSurface('scout', '/tmp/path with spaces'), 'w9:p2');
  assert.deepEqual(f.calls[0], ['pane','split','--pane','w9:p1','--direction','right','--cwd','/tmp/path with spaces','--no-focus']);
});
for (const pane of ['w9:p1', 'w9:p99', '--current', '']) {
  test(`refuses controlling unowned target ${JSON.stringify(pane)}`, () => {
    const f = fixture();
    for (const fn of [() => f.backend.closeSurface(pane), () => f.backend.sendCommand(pane, 'hello'), () => f.backend.readScreen(pane)]) assert.throws(fn, /not created/);
    assert.equal(f.calls.length, 0);
  });
}
test('refuses unrelated split source and unsupported directions', () => {
  const f = fixture();
  assert.throws(() => f.backend.createSurfaceSplit('x', 'right', 'w9:p99'), /unrelated/);
  assert.throws(() => f.backend.createSurfaceSplit('x', 'left'), /right\/down/);
  assert.equal(f.calls.length, 0);
});
for (const reply of ['not-json', '{"result":{}}', '{"error":{"message":"private"}}', '{"result":{"pane":{"pane_id":"w9:p1"}}}', '{"result":{"pane":{"pane_id":"--current"}}}']) {
  test(`rejects invalid creation response ${reply}`, () => {
    const f = fixture({ run: () => reply });
    assert.throws(() => f.backend.createSurface('test'), /response|pane ID/);
  });
}
test('messages are passed as one literal argv, not a host shell command', () => {
  const f = fixture(), pane = f.backend.createSurface('test');
  const text = "hello '$HOME'; $(not-executed)";
  f.backend.sendCommand(pane, text);
  assert.deepEqual(f.calls.at(-1), ['pane','run',pane,text]);
});
test('bounded reads use unwrapped raw output, sync and async', async () => {
  const f = fixture(), pane = f.backend.createSurface('test');
  f.backend.readScreen(pane, 100000);
  assert.deepEqual(f.calls.at(-1), ['pane','read',pane,'--source','recent-unwrapped','--lines','400','--raw']);
  assert.equal(await f.backend.readScreenAsync(pane, -1), 'mock screen');
  assert.ok(f.calls.at(-1).includes('1'));
});
test('closed targets cannot subsequently receive messages or be closed again', () => {
  const f = fixture(), pane = f.backend.createSurface('test');
  f.backend.closeSurface(pane);
  assert.throws(() => f.backend.sendCommand(pane, 'hello'), /not created/);
  assert.throws(() => f.backend.closeSurface(pane), /not created/);
});
test('errors never echo command text or CLI stderr', () => {
  let fail = false;
  const f = fixture({ run: args => {
    if (fail) throw new Error('secret-token + command ' + args.join(' '));
    return '{"result":{"pane":{"pane_id":"w9:p2"}}}';
  }});
  const pane = f.backend.createSurface('test'); fail = true;
  assert.throws(() => f.backend.sendCommand(pane, 'secret-token'), e => !e.message.includes('secret-token'));
});
for (const code of [0, 7, 127]) {
  test(`private launcher records real exit status ${code}, not screen text`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'herdr-adapter-test-'));
    try {
      const f = fixture(), pane = f.backend.createSurface('test');
      const path = join(dir, "launch 'quoted'.sh"), injected = join(dir, 'must-not-exist');
      f.backend.sendLongCommand(pane, `bash -c 'exit ${code}'; echo '__SUBAGENT_DONE_'$?'__'`, {
        scriptPath: path, scriptPreamble: `name\ntouch ${shellEscape(injected)}`,
      });
      assert.equal(statSync(path).mode & 0o777, 0o600);
      try { execFileSync('bash', [path]); } catch (error) { assert.equal(error.status, code); }
      assert.throws(() => statSync(injected), /ENOENT/);
      assert.equal(readFileSync(path + '.done', 'utf8').trim(), String(code));
      const result = await f.backend.pollForExit(pane, new AbortController().signal, { interval: 10 });
      assert.equal(result.exitCode, code);
      assert.equal(result.reason, 'sentinel');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
test('will not overwrite an existing script/symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'herdr-adapter-test-'));
  try {
    const target = join(dir, 'target'), path = join(dir, 'launch.sh');
    writeFileSync(target, 'untouched'); symlinkSync(target, path);
    const f = fixture(), pane = f.backend.createSurface('test');
    assert.throws(() => f.backend.sendLongCommand(pane, "true; echo '__SUBAGENT_DONE_'$?'__'", {scriptPath: path}), /EEXIST/);
    assert.equal(readFileSync(target, 'utf8'), 'untouched');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('unsupported launch trailer fails before any script execution', () => {
  const f = fixture(), pane = f.backend.createSurface('test');
  const dir = mkdtempSync(join(tmpdir(), 'herdr-adapter-test-'));
  try { assert.throws(() => f.backend.sendLongCommand(pane, 'echo hello', {scriptPath: join(dir,'launch.sh')}), /exit-status trailer/); }
  finally { rmSync(dir, {recursive:true,force:true}); }
  assert.equal(f.calls.length, 1);
});
test('provider error sidecar is bounded and reported as failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'herdr-adapter-test-'));
  try {
    const sessionFile = join(dir,'child.jsonl');
    writeFileSync(sessionFile+'.exit', JSON.stringify({type:'error',errorMessage:'e'.repeat(4000)}));
    const f = fixture(), pane = f.backend.createSurface('test');
    const result = await f.backend.pollForExit(pane, new AbortController().signal, {sessionFile,interval:10});
    assert.equal(result.exitCode,1); assert.equal(result.errorMessage.length,2048);
    assert.throws(() => statSync(sessionFile+'.exit'), /ENOENT/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('three failed reads terminate instead of polling forever', async () => {
  const f = fixture({runAsync: async () => {throw new Error('gone');}}), pane=f.backend.createSurface('test');
  const result = await f.backend.pollForExit(pane,new AbortController().signal,{interval:10});
  assert.equal(result.exitCode,1); assert.match(result.errorMessage,/unconfirmed/);
});
test('screen sentinel cannot forge completion; cancellation stops polling', async () => {
  const f=fixture({runAsync:async()=> '__SUBAGENT_DONE_0__'}), pane=f.backend.createSurface('test');
  const controller=new AbortController();
  const promise=f.backend.pollForExit(pane,controller.signal,{interval:10});
  setTimeout(()=>controller.abort(),35);
  await assert.rejects(promise,e=>e.name==='AbortError');
});
test('already-aborted polls perform no reads', async () => {
  const f=fixture(), pane=f.backend.createSurface('test'), c=new AbortController(); c.abort();
  await assert.rejects(f.backend.pollForExit(pane,c.signal,{interval:10}),e=>e.name==='AbortError');
  assert.equal(f.calls.length,1);
});
for (const text of ['short', '界'.repeat(20000), 'line\n'.repeat(3000)]) {
  test(`completion bound: ${text.length} characters`, () => {
    const result=boundedText(text);
    assert.ok(Buffer.byteLength(result)<=16384); assert.ok(result.split('\n').length<=400);
    if (text==='short') assert.equal(result,text); else assert.match(result,/Truncated/);
  });
}
test('shell escaping preserves literal special characters', () => {
  const input="a ' $HOME `literal` \n b";
  assert.equal(execFileSync('bash',['-c',`printf %s ${shellEscape(input)}`],{encoding:'utf8'}),input);
  assert.throws(()=>shellEscape('bad\0argument'),/Invalid/);
});
