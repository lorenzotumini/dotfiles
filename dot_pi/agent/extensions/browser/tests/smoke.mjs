// Real local Chromium tests, using a disposable profile and synthetic secrets.
// Never connects to real accounts or touches the user's default browser profile.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { bounded, safeHeaders, safeUrl } from '../safety.mjs';

let checks = 0;
const secret = 'SYNTHETIC_CREDENTIAL_DO_NOT_RETURN';
const sanitized = safeHeaders({
  Authorization: `Bearer ${secret}`, 'Proxy-Authorization': secret,
  Cookie: `session=${secret}`, 'Set-Cookie': `session=${secret}`,
  'X-Api-Key': secret, 'X-Auth-Token': secret, 'X-Csrf-Token': secret,
  'X-Session-Id': secret, 'X-Client-Secret': secret,
  Location: `/done?access_token=${secret}#${secret}`,
  'Content-Type': 'application/json',
}, 'https://example.test/');
assert.ok(!JSON.stringify(sanitized).includes(secret));
assert.equal(sanitized.authorization, '[redacted]');
assert.equal(sanitized['content-type'], 'application/json');
assert.ok(!safeUrl(`https://user:${secret}@example.test/?api_key=${secret}&page=2#${secret}`).includes(secret));
for (const text of ['🚀漢字'.repeat(10000), 'line\n'.repeat(1000)]) {
  const output = bounded(text);
  assert.ok(output.truncated);
  assert.ok(Buffer.byteLength(output.text) <= 16384);
  assert.ok(output.text.split('\n').length <= 400);
  assert.ok(!output.text.includes('\ufffd'));
}
checks += 5;

let piDir = process.env.PI_CODING_AGENT_PACKAGE ?? resolve(dirname(process.execPath), '../lib/node_modules/@earendil-works/pi-coding-agent');
if (!existsSync(piDir)) {
  const env = { ...process.env }; delete env.npm_config_prefix;
  piDir = join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', env }).trim(), '@earendil-works/pi-coding-agent');
}
const { loadExtensions } = await import(pathToFileURL(join(piDir, 'dist/core/extensions/loader.js')));
const profile = await mkdtemp(join(tmpdir(), 'pi-browser-test-'));
const oldProfile = process.env.PI_BROWSER_PROFILE;
const oldHeadful = process.env.PI_BROWSER_HEADFUL;
process.env.PI_BROWSER_PROFILE = profile;
delete process.env.PI_BROWSER_HEADFUL;
const shots = [];
let extension;
let ctx;
const server = createServer((req, res) => {
  if (req.url.startsWith('/api')) {
    res.writeHead(200, {
      'content-type': 'application/json', 'set-cookie': `session=${secret}; Path=/; HttpOnly`,
      'x-api-key': secret, 'x-access-token': secret,
      location: `/done?code=${secret}#${secret}`,
      'access-control-allow-origin': '*', 'x-safe-debug': 'yes',
    });
    res.end('{"ok":true}');
  } else if (req.url.startsWith('/fail')) {
    req.socket.destroy();
  } else if (req.url.startsWith('/favicon')) {
    res.writeHead(204); res.end();
  } else {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<html><head><title>Browser fixture</title></head><body>
      <input id="name"><button id="apply" onclick="document.querySelector('#result').textContent=document.querySelector('#name').value;console.log('clicked-fixture')">Apply</button>
      <p id="result">initial</p></body></html>`);
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const entry = resolve(dirname(fileURLToPath(import.meta.url)), '../index.ts');
  const loaded = await loadExtensions([entry], process.cwd());
  assert.deepEqual(loaded.errors, []);
  extension = loaded.extensions[0];
  assert.equal(extension.tools.size, 8);
  const toolNames = [...extension.tools.keys()];
  let active = ['read', ...toolNames];
  let branch = [];
  loaded.runtime.getActiveTools = () => active;
  loaded.runtime.setActiveTools = names => { active = names; };
  loaded.runtime.appendEntry = (customType, data) => branch.push({ type: 'custom', customType, data });
  const messages = [];
  ctx = { ui: { notify: text => messages.push(text) }, sessionManager: {
    getBranch: () => branch,
    getEntries: () => { throw new Error('Must restore only the active branch'); },
  } };
  async function start() {
    for (const fn of extension.handlers.get('session_start')) await fn({ reason: 'startup' }, ctx);
  }
  async function command(args) { await extension.commands.get('browser').handler(args, ctx); }
  const called = new Set();
  async function call(name, params = {}) {
    called.add(name);
    const result = await extension.tools.get(name).definition.execute('test', params);
    assert.ok(Buffer.byteLength(result.content[0].text) <= 16384, `${name} text bound`);
    assert.ok(result.content[0].text.split('\n').length <= 400, `${name} line bound`);
    assert.ok(Buffer.byteLength(JSON.stringify(result.details)) < 2048, `${name} metadata bound`);
    assert.ok(!JSON.stringify(result).includes(secret), `${name} leaked synthetic credential`);
    checks++;
    return result;
  }
  const evalJS = expression => call('browser_eval', { expression });
  const text = result => result.content[0].text;
  await start();
  assert.deepEqual(active, ['read']);
  await command('on');
  assert.ok(toolNames.every(name => active.includes(name)));
  assert.ok(active.includes('read'));
  await command('on');
  assert.equal(branch.length, 1);
  await start();
  assert.ok(active.includes('browser_eval'));

  const nav = await call('browser_goto', { url: `${base}/?token=${secret}#${secret}` });
  assert.equal(nav.details.status, 200);
  await call('browser_fill', { selector: '#name', value: 'works' });
  await call('browser_click', { selector: '#apply' });
  assert.equal(text(await evalJS('document.querySelector("#result").textContent')), 'works');
  for (const expression of ['1+1', '() => 2', '(async () => 2)', '(() => 2)()']) {
    assert.equal(text(await evalJS(expression)), '2');
  }
  const huge = await evalJS('({ text: "🚀".repeat(200000) })');
  assert.equal(huge.details.truncated, true);
  assert.equal(huge.details.result, undefined);
  await assert.rejects(evalJS('(() => { throw new Error("intentional fixture error") })()'), /intentional fixture error/);
  await assert.rejects(evalJS('('), /eval error/);
  try { await evalJS('(() => { throw new Error("x".repeat(100000)) })()'); assert.fail('expected error'); }
  catch (error) { assert.ok(Buffer.byteLength(error.message) <= 2048); }
  await assert.rejects(call('browser_fill', { selector: '[', value: secret }), error => !error.message.includes(secret) && /value omitted/.test(error.message));
  // A failed operation must not poison the serialized queue.
  assert.equal(text(await evalJS('true')), 'true');
  checks += 4;

  await evalJS(`async () => { const r=await fetch('/api?token=${secret}', {headers:{Authorization:'Bearer ${secret}', 'X-Api-Key':'${secret}'}}); await r.text(); return r.status; }`);
  // A second request exercises cookie capture (HttpOnly cookie set by first).
  await evalJS(`async () => { const r=await fetch('/api?second=1'); await r.text(); return r.status; }`);
  let network;
  for (let i=0; i<30; i++) {
    network = await call('browser_network', { urlFilter:'/api', verbose:true, includeHeaders:['X-Api-Key','X-Access-Token','X-Safe-Debug','Cookie','Set-Cookie'], clear:false });
    if (text(network).includes('cookie: [redacted]') && network.details.matched >= 2) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.match(text(network), /authorization: \[redacted\]/);
  assert.match(text(network), /set-cookie: \[redacted\]/);
  assert.match(text(network), /cookie: \[redacted\]/);
  assert.match(text(network), /x-api-key: \[redacted\]/);
  assert.match(text(network), /x-safe-debug: yes/);
  assert.equal(network.details.entries, undefined);
  const terse = await call('browser_network', { urlFilter:'/api', clear:false });
  assert.ok(!text(terse).includes('authorization:'));
  const noMatches = await call('browser_network', { status:404 });
  assert.equal(text(noMatches), '(empty)');
  assert.equal(text(await call('browser_network')), '(empty)'); // clears even filtered-out rows

  await call('browser_console');
  await evalJS('() => { for(let i=0;i<250;i++) console.log("entry-"+i+" "+"x".repeat(5000)); return true; }');
  await evalJS('async () => { setTimeout(() => { throw new Error("pageerror-fixture") },0); await new Promise(r=>setTimeout(r,100)); return true; }');
  const consoleLog = await call('browser_console', { limit:200, clear:false });
  assert.equal(consoleLog.details.selected, 200);
  assert.equal(consoleLog.details.truncated, true);
  const pageErrors = await call('browser_console', { filter:'pageerror-fixture', clear:false });
  assert.match(text(pageErrors), /pageerror/);
  await call('browser_console', { filter:'nonexistent' });
  assert.equal(text(await call('browser_console')), '(empty)');

  // Large network text is bounded too; no full entries escape through details.
  await evalJS(`async () => { await Promise.all(Array.from({length:80},(_,i)=>fetch('/api?n='+i+'&padding='+'x'.repeat(1500)).then(r=>r.text()))); await new Promise(r=>setTimeout(r,100)); return true; }`);
  const bigNetwork = await call('browser_network', { limit:200, verbose:true });
  assert.equal(bigNetwork.details.truncated, true);

  const shot = await call('browser_screenshot');
  shots.push(dirname(shot.details.path));
  assert.equal((await readFile(shot.details.path)).subarray(0,8).toString('hex'), '89504e470d0a1a0a');
  await evalJS('localStorage.setItem("fixture-persist", "yes")');
  await assert.rejects(call('browser_goto', { url: `${base}/fail?token=${secret}`, timeoutMs: 2000 }), error => /Navigation failed/.test(error.message) && !error.message.includes(secret));
  checks++;
  await call('browser_close');
  assert.equal(text(await call('browser_console')), '(empty)');
  assert.equal(text(await call('browser_network')), '(empty)');
  await call('browser_goto', { url: base });
  assert.equal(text(await evalJS('localStorage.getItem("fixture-persist")')), 'yes');
  // Same-page operations serialize in submission order.
  await Promise.all([call('browser_fill',{selector:'#name',value:'first'}), call('browser_fill',{selector:'#name',value:'second'})]);
  assert.equal(text(await evalJS('document.querySelector("#name").value')), 'second');
  await command('off');
  assert.deepEqual(active, ['read']);
  await command('');
  assert.match(messages.at(-1), /enabled/);
  assert.deepEqual([...active].sort(), ['read', ...toolNames].sort());
  await command('off');
  assert.deepEqual(active, ['read']);
  branch = [];
  await start();
  assert.deepEqual(active, ['read']);
  assert.deepEqual([...called].sort(), toolNames.sort());
  console.log(`PASS: ${checks} checks; all 8 tools, real Chromium, synthetic-header redaction, bounded output/errors, gate/restore, buffers, screenshots, persistence and serialization.`);
} finally {
  if (extension) for (const fn of extension.handlers.get('session_shutdown') ?? []) await fn({ reason:'quit' }, ctx);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (oldProfile === undefined) delete process.env.PI_BROWSER_PROFILE; else process.env.PI_BROWSER_PROFILE = oldProfile;
  if (oldHeadful === undefined) delete process.env.PI_BROWSER_HEADFUL; else process.env.PI_BROWSER_HEADFUL = oldHeadful;
  await rm(profile, {recursive:true,force:true});
  for (const shot of shots) await rm(shot, {recursive:true,force:true});
}
