import { TuiAltScreen, TuiMainScreen } from '@earendil-works/pi-tui';

// ConPTY can remove the OSC header from palette replies. The remaining text
// enters the prompt, and a BEL terminator becomes Ctrl+G (external editor).
// Pi's fragmented-reply fix cannot recover a header that never reaches stdin.
// https://github.com/earendil-works/pi/issues/10256
const installed = Symbol.for('dot-pi.windows-terminal-colors');

export default function windowsTerminalColors() {
  for (const screen of [TuiAltScreen, TuiMainScreen]) {
    const prototype = screen.prototype as typeof screen.prototype & { [installed]?: boolean };
    if (prototype[installed]) continue;

    const query = prototype.queryTerminalColors;
    prototype.queryTerminalColors = function (options) {
      // Apply before the first query, including startup, reload, resume and the
      // animated logo. An explicit Pi theme works without terminal color reports.
      // Opt back in after an upstream fix: $env:PI_TERMINAL_COLOR_QUERIES = '1'.
      if (process.platform === 'win32' && process.env.PI_TERMINAL_COLOR_QUERIES !== '1') {
        return Promise.resolve({});
      }
      return query.call(this, options);
    };
    prototype[installed] = true;
  }
}
