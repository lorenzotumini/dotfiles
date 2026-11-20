import * as tmux from './tmux.ts';
import * as herdr from './herdr.mjs';
import * as herdrCore from './herdr-core.mjs';
import { selectMux } from './herdr-context.mjs';

const selected = selectMux();
const backends = { herdr, 'herdr-core': herdrCore, tmux };
if (!Object.hasOwn(backends, selected)) {
  throw new Error('Unsupported PI_SUBAGENT_MUX; choose herdr, herdr-core (hc), or tmux');
}
const backend = backends[selected as keyof typeof backends];

export const usingHerdr = selected === 'herdr' || selected === 'herdr-core';
export const { isMuxAvailable, muxSetupHint, sendCommand, sendLongCommand, pollForExit, closeSurface, shellEscape, readScreen } = backend;

export async function createSurface(name: string, cwd?: string) {
  const terminal = backend.createSurface(name, cwd);
  if (backend === herdrCore) await herdrCore.showSurface(terminal);
  return terminal;
}
