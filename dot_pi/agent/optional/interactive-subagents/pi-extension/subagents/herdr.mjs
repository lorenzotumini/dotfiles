// Local Herdr backend. No calls to a focused/default session: caller context
// and explicit pane IDs are mandatory. Only panes created here are controlled.
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inHerdrCli } from './herdr-context.mjs';
import { createHerdrLauncher, shellEscape } from './herdr-launch.mjs';

const execAsync = promisify(execFile);
const CLI_OPTIONS = { encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024 };
const HINT = 'Run Pi inside a Herdr-managed pane; in pi-lean, enable with /subagents. Plain-terminal subagents are not supported.';

export { shellEscape };

export function createHerdrBackend({
  env = process.env,
  run = (args) => execFileSync('herdr', args, CLI_OPTIONS),
  runAsync = async (args) => (await execAsync('herdr', args, CLI_OPTIONS)).stdout,
} = {}) {
  const owned = new Set();
  const launcher = createHerdrLauncher({
    sendCommand,
    checkLiveness: async pane => { await readScreenAsync(pane, 1); },
    livenessError: 'Child pane disappeared or could not be read three times; completion is unconfirmed.',
    tempPrefix: 'pi-herdr-subagent-',
  });
  const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(id);
  const inHerdr = () => inHerdrCli(env);
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
    launcher.forget(pane);
  }
  function sendLongCommand(pane, command, options) {
    requireOwned(pane);
    return launcher.sendLongCommand(pane, command, options);
  }
  async function pollForExit(pane, signal, options) {
    requireOwned(pane);
    return launcher.pollForExit(pane, signal, options);
  }
  return { isMuxAvailable, muxSetupHint: () => HINT, createSurface, createSurfaceSplit, sendCommand, sendLongCommand, readScreen, readScreenAsync, closeSurface, pollForExit };
}

export const { isMuxAvailable, muxSetupHint, createSurface, createSurfaceSplit, sendCommand, sendLongCommand, readScreen, readScreenAsync, closeSurface, pollForExit } = createHerdrBackend();
