// Keep the upstream tmux implementation unchanged. Herdr is explicitly selected
// by the trial launcher, or detected only in a Herdr-managed caller pane.
import * as tmux from './tmux.ts';
import * as herdr from './herdr.mjs';

const requested = process.env.PI_SUBAGENT_MUX;
if (requested && requested !== 'herdr' && requested !== 'tmux') {
  throw new Error('Unsupported PI_SUBAGENT_MUX; choose herdr or tmux');
}
const backend = requested === 'herdr' || (!requested && process.env.HERDR_ENV === '1') ? herdr : tmux;
export const { isMuxAvailable, muxSetupHint, createSurface, sendCommand, sendLongCommand, pollForExit, closeSurface, shellEscape, readScreen } = backend;
