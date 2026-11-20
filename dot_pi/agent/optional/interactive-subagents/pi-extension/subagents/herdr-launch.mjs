import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

export function shellEscape(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid shell argument');
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

// Both Herdr backends share the private launcher and file-backed completion protocol.
export function createHerdrLauncher({ sendCommand, checkLiveness, livenessError, tempPrefix }) {
  const completionFiles = new Map();

  function sendLongCommand(pane, command, options = {}) {
    const marker = /; echo '__SUBAGENT_DONE_'\$\?'__'$/;
    if (!marker.test(command)) throw new Error('Unsupported launch command: missing exit-status trailer');
    const path = options.scriptPath ?? join(mkdtempSync(join(tmpdir(), tempPrefix)), 'launch.sh');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // Parent completion is file-backed, not recognized from model-controlled
    // terminal text. The launcher passes an explicit exit-code writer.
    const donePath = `${path}.done`;
    const preamble = (options.scriptPreamble ?? '').split('\n').map(line => '# ' + line).join('\n');
    const invocation = command.replace(marker, '');
    const shDone = process.platform === 'win32' ? donePath.replace(/\\/g, '/') : donePath;
    const body = `${invocation}\npi_child_status=$?\nprintf '%s\\n' "$pi_child_status" > ${shellEscape(shDone + '.tmp')}\nmv -- ${shellEscape(shDone + '.tmp')} ${shellEscape(shDone)}\nexit "$pi_child_status"\n`;
    writeFileSync(path, `#!/usr/bin/env bash\numask 077\n${preamble}\n${body}`, { mode: 0o600, flag: 'wx' });
    completionFiles.set(pane, donePath);
    const shPath = process.platform === 'win32' ? path.replace(/\\/g, '/') : path;
    const runner = process.platform === 'win32' ? 'sh' : 'bash';
    try { sendCommand(pane, `${runner} ${shellEscape(shPath)}`); }
    catch (error) { completionFiles.delete(pane); throw error; }
    return path;
  }

  function readSmall(path, max = 8192) {
    if (statSync(path).size > max) throw new Error('Oversized child status file');
    return readFileSync(path, 'utf8');
  }
  async function pollForExit(pane, signal, options) {
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
      try {
        const result = await checkLiveness(pane, signal);
        if (result) return result;
        readFailures = 0;
      } catch {
        signal.throwIfAborted();
        if (++readFailures >= 3) return { reason: 'error', exitCode: 1, errorMessage: livenessError };
      }
      signal.throwIfAborted();
      options.onTick?.(Math.floor((Date.now() - start) / 1000));
      await sleep(delay, undefined, { signal });
    }
  }
  return { sendLongCommand, pollForExit, forget: pane => completionFiles.delete(pane) };
}
