// Local Herdr backend. No calls to a focused/default session: caller context
// and explicit pane IDs are mandatory. Only panes created here are controlled.
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const execAsync = promisify(execFile);
const CLI_OPTIONS = { encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024 };
const HINT = 'Run Pi inside a Herdr-managed pane; in pi-lean, enable with /subagents on. Plain-terminal subagents are not supported.';

export function shellEscape(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid shell argument');
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

export function createHerdrBackend({
  env = process.env,
  run = (args) => execFileSync('herdr', args, CLI_OPTIONS),
  runAsync = async (args) => (await execAsync('herdr', args, CLI_OPTIONS)).stdout,
} = {}) {
  const owned = new Set();
  const completionFiles = new Map();
  const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(id);
  const inHerdr = () => env.HERDR_ENV === '1' && validId(env.HERDR_PANE_ID) && !!env.HERDR_SOCKET_PATH;
  function requireHerdr() {
    if (!inHerdr()) throw new Error(HINT);
  }
  function requireOwned(pane) {
    requireHerdr();
    if (!owned.has(pane) || pane === env.HERDR_PANE_ID) {
      throw new Error('Refusing to control a pane not created by this subagent backend');
    }
  }
  function call(args) {
    requireHerdr();
    try { return run(args); }
    catch { throw new Error(`Herdr pane ${args[1] ?? 'operation'} failed (unavailable, rejected, or timed out); inspect the child pane. Command text is omitted.`); }
  }
  function jsonCall(args) {
    const raw = call(args);
    try {
      const data = JSON.parse(raw);
      if (data.error || !data.result) throw new Error();
      return data.result;
    } catch { throw new Error('Invalid Herdr response; no pane target was inferred'); }
  }
  function isMuxAvailable() {
    if (!inHerdr()) return false;
    try { run(['--version']); return true; } catch { return false; }
  }
  function createSurfaceSplit(_name, direction = 'right', fromSurface = env.HERDR_PANE_ID, cwd = process.cwd()) {
    requireHerdr();
    if (fromSurface !== env.HERDR_PANE_ID && !owned.has(fromSurface)) {
      throw new Error('Refusing to split an unrelated pane');
    }
    if (!['right', 'down'].includes(direction)) throw new Error('Herdr supports right/down splits only');
    const result = jsonCall(['pane', 'split', '--pane', fromSurface, '--direction', direction, '--cwd', cwd, '--no-focus']);
    const pane = result.pane?.pane_id;
    if (!validId(pane) || pane === env.HERDR_PANE_ID || owned.has(pane)) {
      throw new Error('Herdr did not return a new child pane ID; inspect the layout before retrying');
    }
    owned.add(pane);
    return pane;
  }
  function createSurface(name, cwd = process.cwd()) {
    // Side-by-side panes with a vertical divider, as requested. No global
    // rebalancing: never resize other panes or steal the user's focus.
    return createSurfaceSplit(name, 'right', env.HERDR_PANE_ID, cwd);
  }
  function sendCommand(pane, command) {
    requireOwned(pane);
    if (typeof command !== 'string' || command.includes('\0')) throw new Error('Invalid pane input');
    call(['pane', 'run', pane, command]);
  }
  function sendLongCommand(pane, command, options = {}) {
    requireOwned(pane);
    const path = options.scriptPath ?? join(mkdtempSync(join(tmpdir(), 'pi-herdr-subagent-')), 'launch.sh');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // Parent completion is file-backed, not recognized from model-controlled
    // terminal text. The launcher passes an explicit exit-code writer.
    const donePath = `${path}.done`;
    const preamble = (options.scriptPreamble ?? '').split('\n').map(line => '# ' + line).join('\n');
    const marker = /; echo '__SUBAGENT_DONE_'\$\?'__'$/;
    if (!marker.test(command)) throw new Error('Unsupported launch command: missing exit-status trailer');
    const invocation = command.replace(marker, '');
    const body = `${invocation}\npi_child_status=$?\nprintf '%s\\n' "$pi_child_status" > ${shellEscape(donePath + '.tmp')}\nmv -- ${shellEscape(donePath + '.tmp')} ${shellEscape(donePath)}\nexit "$pi_child_status"\n`;
    writeFileSync(path, `#!/usr/bin/env bash\numask 077\n${preamble}\n${body}`, { mode: 0o600, flag: 'wx' });
    completionFiles.set(pane, donePath);
    try { sendCommand(pane, `bash ${shellEscape(path)}`); }
    catch (error) { completionFiles.delete(pane); throw error; }
    return path;
  }
  function readArgs(pane, lines) {
    requireOwned(pane);
    const count = Number.isFinite(lines) ? Math.min(400, Math.max(1, Math.floor(lines))) : 50;
    return ['pane', 'read', pane, '--source', 'recent-unwrapped', '--lines', String(count), '--raw'];
  }
  function readScreen(pane, lines = 50) { return call(readArgs(pane, lines)); }
  async function readScreenAsync(pane, lines = 50) {
    const args = readArgs(pane, lines);
    try { return await runAsync(args); }
    catch { throw new Error('Herdr child pane read failed or timed out'); }
  }
  function closeSurface(pane) {
    requireOwned(pane);
    call(['pane', 'close', pane]);
    owned.delete(pane);
    completionFiles.delete(pane);
  }
  function readSmall(path, max = 8192) {
    if (statSync(path).size > max) throw new Error('Oversized child status file');
    return readFileSync(path, 'utf8');
  }
  async function pollForExit(pane, signal, options) {
    requireOwned(pane);
    const start = Date.now();
    let readFailures = 0;
    const delay = Math.max(10, options.interval ?? 1000);
    while (true) {
      signal.throwIfAborted();
      if (options.sessionFile) {
        try {
          const path = `${options.sessionFile}.exit`;
          const data = JSON.parse(readSmall(path));
          unlinkSync(path);
          if (data.type === 'error') return { reason: 'error', exitCode: 1, errorMessage: String(data.errorMessage || 'Child provider error').slice(0, 2048) };
          return { reason: 'done', exitCode: 0 };
        } catch { /* Not written yet or incomplete. */ }
      }
      const donePath = completionFiles.get(pane);
      if (donePath) {
        try {
          const status = readSmall(donePath, 32).trim();
          if (/^\d{1,3}$/.test(status) && Number(status) <= 255) {
            return { reason: 'sentinel', exitCode: Number(status) };
          }
        } catch { /* Child is still running. */ }
      }
      // Check liveness, but never interpret terminal contents as completion.
      try { await readScreenAsync(pane, 1); readFailures = 0; }
      catch {
        if (++readFailures >= 3) return { reason: 'error', exitCode: 1, errorMessage: 'Child pane disappeared or could not be read three times; completion is unconfirmed.' };
      }
      signal.throwIfAborted();
      options.onTick?.(Math.floor((Date.now() - start) / 1000));
      await sleep(delay, undefined, { signal });
    }
  }
  return { isMuxAvailable, muxSetupHint: () => HINT, createSurface, createSurfaceSplit, sendCommand, sendLongCommand, readScreen, readScreenAsync, closeSurface, pollForExit };
}

export const { isMuxAvailable, muxSetupHint, createSurface, createSurfaceSplit, sendCommand, sendLongCommand, readScreen, readScreenAsync, closeSurface, pollForExit } = createHerdrBackend();
