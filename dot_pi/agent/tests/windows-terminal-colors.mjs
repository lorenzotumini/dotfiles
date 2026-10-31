import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const piDir = process.env.PI_CODING_AGENT_PACKAGE ?? (process.platform === 'win32'
  ? join(process.env.APPDATA, 'npm/node_modules/@earendil-works/pi-coding-agent')
  : resolve(dirname(process.execPath), '../lib/node_modules/@earendil-works/pi-coding-agent'));
const entry = resolve(dirname(fileURLToPath(import.meta.url)), '../extensions/windows-terminal-colors/index.ts');
const temporary = mkdtempSync(join(tmpdir(), 'pi-terminal-colors-test-'));
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const originalOptIn = process.env.PI_TERMINAL_COLOR_QUERIES;

try {
  const { StdinBuffer } = await import(pathToFileURL(join(piDir, 'node_modules/@earendil-works/pi-tui/dist/stdin-buffer.js')));
  const buffer = new StdinBuffer();
  const input = [];
  buffer.on('data', sequence => input.push(sequence));
  buffer.process(';rgb:4646/c8c8/8080\x07');
  assert.equal(input.join(''), ';rgb:4646/c8c8/8080\x07');
  assert.ok(input.includes('\x07'), 'headerless reply emits the external-editor shortcut');
  buffer.destroy();

  const probe = join(temporary, 'probe.ts');
  writeFileSync(probe, "import { TuiAltScreen, TuiMainScreen } from '@earendil-works/pi-tui';\nexport default function () { globalThis.__dotPiColorTestTui = [TuiAltScreen, TuiMainScreen]; }\n");
  const sourceLoader = await import(pathToFileURL(join(piDir, 'dist/core/extensions/loader.js')));
  const bundled = await import(pathToFileURL(join(piDir, 'dist/bundle/index.js')));
  for (const [name, load] of [
    ['unbundled', () => sourceLoader.loadExtensions([entry, probe], temporary)],
    ['bundled CLI', () => bundled.discoverAndLoadExtensions([entry, probe], temporary, join(temporary, 'agent'))],
  ]) {
    const result = await load();
    assert.deepEqual(result.errors, [], name);
    assert.ok(globalThis.__dotPiColorTestTui, `${name}: probe loaded`);
    for (const TUI of globalThis.__dotPiColorTestTui) {
      const wrapped = TUI.prototype.queryTerminalColors;
      const writes = [];
      const ui = Object.assign(Object.create(TUI.prototype), {
        terminal: { write: text => writes.push(text) }, pendingTerminalColorQueries: [],
      });
      const query = () => wrapped.call(ui, { timeoutMs: 1 });

      Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
      delete process.env.PI_TERMINAL_COLOR_QUERIES;
      for (let i = 0; i < 3; i++) assert.deepEqual(await query(), {});
      assert.deepEqual(writes, [], `${name}: repeated Windows queries emit no bytes`);
      assert.equal(ui.pendingTerminalColorQueries.length, 0);

      process.env.PI_TERMINAL_COLOR_QUERIES = '1';
      await query();
      assert.ok(writes.pop().includes('\x1b]4;15;?\x07'), `${name}: opt-in preserves palette query`);

      delete process.env.PI_TERMINAL_COLOR_QUERIES;
      Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'linux' });
      await query();
      assert.ok(writes.pop().includes('\x1b]11;?\x07'), `${name}: Linux preserves color query`);
      Object.defineProperty(process, 'platform', originalPlatform);

      assert.deepEqual((await load()).errors, []);
      assert.equal(TUI.prototype.queryTerminalColors, wrapped, `${name}: reloading does not stack wrappers`);
    }
    console.log(`PASS: ${name} Windows query suppression, opt-in, Linux behavior and reload.`);
  }
  console.log('PASS: headerless color reply reproduces text leakage and Ctrl+G. No live terminal UI test.');
} finally {
  Object.defineProperty(process, 'platform', originalPlatform);
  if (originalOptIn === undefined) delete process.env.PI_TERMINAL_COLOR_QUERIES;
  else process.env.PI_TERMINAL_COLOR_QUERIES = originalOptIn;
  delete globalThis.__dotPiColorTestTui;
  rmSync(temporary, { recursive: true, force: true });
}
