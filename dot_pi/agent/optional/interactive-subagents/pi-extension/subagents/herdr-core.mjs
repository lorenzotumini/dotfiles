// Local herdr-core backend for terminals created by the Herdr desktop app.
import { execFileSync, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { inHerdrApp } from './herdr-context.mjs';
import { createHerdrLauncher, shellEscape } from './herdr-launch.mjs';

export { shellEscape };

const execAsync = promisify(execFile);
const CLI_OPTIONS = { encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024 };
const HINT = 'Run Pi inside the Herdr app with herdr-core (hc) on PATH.';

function terminalName(value) {
  const base = String(value ?? '').toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `sub-${(base || 'subagent').slice(0, 15)}-${randomBytes(6).toString('hex')}`;
}

export function createHerdrCoreBackend({
  env = process.env,
  run,
  runAsync,
  appDo = async args => (await execAsync('herdr-app', ['do', ...args], { ...CLI_OPTIONS, env })).stdout,
} = {}) {
  const coreOptions = { ...CLI_OPTIONS, env: { ...env, HC_SOCKET: env.HC_TERMINAL_SOCKET } };
  run ??= args => execFileSync('hc', args, coreOptions);
  runAsync ??= async (args, signal) => (await execAsync('hc', args, { ...coreOptions, signal })).stdout;
  const owned = new Set();
  const launcher = createHerdrLauncher({
    sendCommand,
    checkLiveness,
    livenessError: 'Child terminal disappeared or could not be queried three times; completion is unconfirmed.',
    tempPrefix: 'pi-herdr-core-subagent-',
  });

  function requireApp() {
    if (!inHerdrApp(env)) throw new Error(HINT);
  }
  function requireOwned(terminal) {
    requireApp();
    if (!owned.has(terminal) || terminal === env.HC_TERMINAL_ID) {
      throw new Error('Refusing to control a terminal not created by this subagent backend');
    }
  }
  function call(args) {
    requireApp();
    try { return run(args); }
    catch { throw new Error(`herdr-core ${args[0]} failed; inspect the child terminal. Command text is omitted.`); }
  }
  function parseResponse(raw) {
    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || data.error) throw new Error();
      return data;
    } catch { throw new Error('Invalid or unsuccessful herdr-core response'); }
  }
  function isMuxAvailable() {
    if (!inHerdrApp(env)) return false;
    try {
      return parseResponse(call(['get', '--json', env.HC_TERMINAL_ID])).state === 'live';
    } catch { return false; }
  }
  function createSurface(name, cwd = process.cwd()) {
    requireApp();
    // Use Bash so launch commands work with any configured Herdr login shell.
    const data = parseResponse(call([
      'run', '--bg', '--json', '--name', terminalName(name), '--cwd', cwd,
      '--parent', env.HC_TERMINAL_ID, '--no-notify', '--', 'bash', '--noprofile', '--norc',
    ]));
    const terminal = data.address;
    if (typeof terminal !== 'string' || !/^t[0-9a-z]+$/.test(terminal) ||
        terminal === env.HC_TERMINAL_ID || owned.has(terminal)) {
      throw new Error('herdr-core did not return a new child terminal address; inspect the layout before retrying');
    }
    owned.add(terminal);
    return terminal;
  }
  async function showSurface(terminal) {
    // The app learns about new core terminals asynchronously.
    for (let attempt = 0; attempt < 7 && owned.has(terminal); attempt++) {
      try {
        await appDo(['terminal.keep', '--terminal', terminal, '--place', 'right']);
        return;
      } catch (error) {
        const response = error?.stdout ?? '';
        if (!response.includes('no running terminal')) return;
        if (attempt < 6) await sleep(150);
      }
    }
  }
  function sendCommand(terminal, command) {
    requireOwned(terminal);
    if (typeof command !== 'string' || command.includes('\0')) throw new Error('Invalid terminal input');
    parseResponse(call(['send', '--force', '--json', '--', terminal, command]));
  }
  function sendLongCommand(terminal, command, options) {
    requireOwned(terminal);
    return launcher.sendLongCommand(terminal, command, options);
  }
  function readScreen(terminal, lines = 50) {
    requireOwned(terminal);
    const count = Number.isFinite(lines) ? Math.min(400, Math.max(0, Math.floor(lines))) : 50;
    return call(['read', terminal, '--lines', String(count)]);
  }
  async function checkLiveness(terminal, signal) {
    requireOwned(terminal);
    const { state } = parseResponse(await runAsync(['get', '--json', terminal], signal));
    signal.throwIfAborted();
    if (state === 'finished') {
      return { reason: 'error', exitCode: 1, errorMessage: 'Child terminal exited before reporting completion.' };
    }
    if (state !== 'live') throw new Error('Unrecognized child terminal state');
  }
  function closeSurface(terminal) {
    requireOwned(terminal);
    // A visible pane can have keep enabled, which would respawn its shell on kill.
    parseResponse(call(['keep', terminal, '--off']));
    parseResponse(call(['kill', terminal]));
    parseResponse(call(['rm', terminal]));
    owned.delete(terminal);
    launcher.forget(terminal);
  }
  async function pollForExit(terminal, signal, options) {
    requireOwned(terminal);
    return launcher.pollForExit(terminal, signal, options);
  }
  return { isMuxAvailable, muxSetupHint: () => HINT, createSurface, showSurface, sendCommand, sendLongCommand, readScreen, closeSurface, pollForExit };
}

export const { isMuxAvailable, muxSetupHint, createSurface, showSurface, sendCommand, sendLongCommand, readScreen, closeSurface, pollForExit } = createHerdrCoreBackend();
