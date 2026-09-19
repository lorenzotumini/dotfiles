import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { apiKey, catalog, checkFiles, configPath, readConfig, renderIni, request, serverUrl } from './core.mjs';

export function paths(c) {
  return { ini: join(c.server.cacheDirectory, 'models.ini'), log: join(c.server.cacheDirectory, 'server.log'), pid: join(c.server.cacheDirectory, 'server.json'), lock: join(c.server.cacheDirectory, 'start.lock') };
}

export function generate(c) {
  checkFiles(c);
  apiKey(c);
  mkdirSync(c.server.cacheDirectory, { recursive: true, mode: 0o700 });
  const { ini } = paths(c);
  const temporary = `${ini}.${process.pid}.tmp`;
  writeFileSync(temporary, renderIni(c), { mode: 0o600 });
  renameSync(temporary, ini);
  return ini;
}

function startTime(pid) {
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).split(' ')[19]; } catch { return undefined; }
}

export function ownedProcess(c) {
  try {
    const info = JSON.parse(readFileSync(paths(c).pid, 'utf8'));
    const args = readFileSync(`/proc/${info.pid}/cmdline`, 'utf8').split('\0');
    if (info.startTime && info.startTime === startTime(info.pid) && args.includes(paths(c).ini) && args.includes('--models-preset')) return info;
  } catch { /* No live managed router. */ }
  return undefined;
}

async function reachable(c) {
  try { await catalog(c, AbortSignal.timeout(1500)); return true; }
  catch (error) {
    // Only a refused connection permits starting a server. Surface authentication/protocol errors.
    if (error.cause?.code === 'ECONNREFUSED') return false;
    throw error;
  }
}

export function serverArgs(c, ini = paths(c).ini) {
  return ['--models-preset', ini, '--models-max', '1', '--no-models-autoload',
    '--host', c.server.host, '--port', String(c.server.port), '--api-key-file', c.server.apiKeyFile,
    '--cors-origins', 'localhost', '--metrics', '--no-ui'];
}

export async function ensureRouter(c, { foreground = false, signal } = {}) {
  if (await reachable(c)) return { started: false };
  mkdirSync(c.server.cacheDirectory, { recursive: true, mode: 0o700 });
  const p = paths(c);
  try { mkdirSync(p.lock); } catch (e) {
    if (e.code === 'EEXIST') throw new Error(`Another router start is in progress. Retry shortly; if it crashed, remove ${p.lock}.`);
    throw e;
  }
  let child;
  try {
    if (await reachable(c)) return { started: false };
    if (ownedProcess(c)) throw new Error(`Managed router is still starting or unhealthy. See ${p.log}`);
    const ini = generate(c);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('LLAMA_ARG_') && !['LLAMA_API_KEY', 'LLAMA_CACHE'].includes(k)));
    env.LLAMA_CACHE = join(c.server.cacheDirectory, 'llama-cache');
    let log;
    if (!foreground) log = openSync(p.log, 'a', 0o600);
    try {
      child = spawn(c.server.binary, serverArgs(c, ini), { env, detached: !foreground, stdio: foreground ? 'inherit' : ['ignore', log, log] });
    } finally { if (log !== undefined) closeSync(log); }
    let spawnError;
    child.on('error', (e) => { spawnError = e; });
    const exit = new Promise((done) => child.once('exit', (code) => done(code)));
    await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject); });
    writeFileSync(p.pid, JSON.stringify({ pid: child.pid, startTime: startTime(child.pid), config: configPath() }) + '\n', { mode: 0o600 });
    if (!foreground) child.unref();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (spawnError || child.exitCode !== null || child.signalCode) throw new Error(`Router exited during startup. See ${p.log}`, { cause: spawnError });
      if (await reachable(c)) return { started: true, child, exit };
      await delay(200, undefined, { signal });
    }
    throw new Error(`Router startup timed out. See ${p.log}`);
  } catch (error) {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    throw error;
  } finally { rmdirSync(p.lock); }
}

export async function stopRouter(c) {
  const info = ownedProcess(c);
  if (!info) throw new Error('No router owned by this launcher; refusing to stop an unrelated process.');
  process.kill(info.pid, 'SIGTERM');
  const deadline = Date.now() + 15000;
  while (ownedProcess(c) && Date.now() < deadline) await delay(200);
  if (ownedProcess(c)) throw new Error('Router has not stopped yet; no forced kill was sent.');
  try { unlinkSync(paths(c).pid); } catch { /* Already removed. */ }
}

export async function reloadRouter(c, signal) {
  // Pi can outlive the server; a stale PID record does not mean another router owns the port.
  await ensureRouter(c, { signal });
  if (!ownedProcess(c)) throw new Error('A router is running at the configured address, but this launcher cannot verify ownership. Stop it from the terminal or service that started it, then run /local:reload again.');
  const active = await catalog(c, signal);
  if (active.some((m) => ['loading', 'downloading'].includes(m.status.value))) throw new Error('A model load is in progress; reload after it finishes.');
  for (const model of active.filter((m) => m.status.value === 'loaded')) {
    const slots = await request(c, `/slots?model=${encodeURIComponent(model.id)}`, { signal });
    if (!Array.isArray(slots) || slots.some((s) => s.is_processing)) throw new Error('A model is busy; reload after its request finishes.');
  }
  generate(c);
  return request(c, '/models?reload=1', { signal });
}

async function main() {
  const c = readConfig();
  const command = process.argv[2] ?? 'start';
  if (command === 'check') { checkFiles(c); apiKey(c); console.log(`Valid: ${c.profiles.length} profiles; model files and API key readable.`); }
  else if (command === 'render') console.log(generate(c));
  else if (command === 'status') console.log(JSON.stringify({ url: serverUrl(c), ownedPid: ownedProcess(c)?.pid, models: await catalog(c) }, null, 2));
  else if (command === 'stop') { await stopRouter(c); console.log('Stopped managed router.'); }
  else if (command === 'reload') { await reloadRouter(c); console.log('Reloaded model presets. Select a profile with /local.'); }
  else if (command === 'start' || command === 'ensure') {
    const result = await ensureRouter(c, { foreground: command === 'start' });
    console.log(`${result.started ? 'Started' : 'Connected to'} router at ${serverUrl(c)}`);
    if (command === 'start' && result.child) {
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => result.child.kill(signal));
      process.exitCode = (await result.exit) ?? 1;
    }
  } else throw new Error('Usage: start.sh [start|ensure|check|render|status|reload|stop]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
