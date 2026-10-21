import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeSloppiness, commandPath, commandOptions, runProcess, ANALYZER_VERSION, C_GRAMMAR_VERSION } from '../core.mjs';

test('C frontend metrics and grammar behavior', async () => {
  const result = await runProcess(process.platform === 'win32' ? 'uv.exe' : 'uv', [
    '--no-config', 'tool', 'run', '--from', `scb-check==${ANALYZER_VERSION}`,
    '--with', `tree-sitter-c==${C_GRAMMAR_VERSION}`, 'python', '-I', '-B', '-X', 'utf8',
    resolve(import.meta.dirname, 'c_parser.py'),
  ]);
  assert.equal(result.code, 0, result.stderr);
});

test('path arguments preserve Windows separators, spaces, and literal shell characters', () => {
  assert.equal(commandPath(''), '.');
  assert.equal(commandPath(' "C:\\my repo\\src" '), 'C:\\my repo\\src');
  assert.equal(commandPath("'./a b'"), './a b');
  assert.equal(commandPath('./a b; echo hi'), './a b; echo hi');
  assert.throws(() => commandPath('"unfinished'), /quote/);
  const options = commandOptions('"C:\\my repo" --include "src/**/*.c" --include "*.h" --regex "\\.(c|h)$" --exclude "deps/**" --list --all --recover');
  assert.equal(options.path, 'C:\\my repo');
  assert.deepEqual(options.include, ['src/**/*.c', '*.h']);
  assert.deepEqual(options.exclude, ['deps/**']);
  assert.equal(options.regex, '\\.(c|h)$');
  assert.equal(options.listOnly, true);
  assert.equal(options.all, true);
  assert.equal(options.recover, true);
  assert.throws(() => commandOptions('--regex'), /needs a pattern/);
});

test('subprocess arguments are literal and cancellation/timeout stop the process', async () => {
  const literal = 'space & $(echo injected); "quoted"';
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', literal]);
  assert.equal(result.stdout, literal);
  assert.equal(result.code, 0);
  const abort = new AbortController();
  const running = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: abort.signal });
  setTimeout(() => abort.abort(), 100);
  await assert.rejects(running, /cancelled/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 }), /timeout/);
});

test('real analyzer handles mixed languages, exclusions, findings, and literal paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pi-quality-test-'));
  t.after(async () => {
    // Only delete this test's freshly allocated temporary directory.
    assert.equal(dirname(root), resolve(tmpdir()));
    assert(root.split(/[\\/]/).at(-1).startsWith('pi-quality-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const repo = join(root, 'repo with spaces & symbols');
  await mkdir(join(repo, '.git'), { recursive: true });
  await mkdir(join(repo, 'vendor'));
  await mkdir(join(repo, 'node_modules'));
  await writeFile(join(repo, '.gitignore'), 'ignored.py\n');
  await writeFile(join(repo, 'scb-check.toml'), 'exclude = ["vendor/**"]\n');
  const branches = Array.from({ length: 12 }, (_, i) => `    if x == ${i}:\n        total += ${i}\n`).join('');
  await writeFile(join(repo, 'complex.py'), `def complex_function(x):\n    total = 0\n${branches}    return total\n`);
  await writeFile(join(repo, 'second.py'), 'def second(x):\n    value = x + 1\n    total = value * 2\n    return total\n');
  await writeFile(join(repo, 'third.py'), 'def third(x):\n    value = x + 1\n    total = value * 2\n    return total\n');
  await writeFile(join(repo, 'sample.ts'), 'export function value(x: number) { return x + 1; }\n');
  for (const path of ['ignored.py', 'vendor/skip.py', 'node_modules/skip.py']) {
    await writeFile(join(repo, path), 'def skipped(x):\n    return x\n');
  }
  await writeFile(join(repo, 'unsupported.tsx'), 'export const X = () => <div/>;\n');
  const first = await analyzeSloppiness(repo);
  const report = JSON.parse(await readFile(first.details.reportPath, 'utf8'));
  assert.equal(report.version, '0.2.0');
  assert.equal(report.metrics.files_scanned, 4);
  assert.deepEqual(report.languages, { python: 3, typescript: 1 });
  assert(report.metrics.erosion > 0);
  assert(report.metrics.clone_loc > 0);
  assert(report.findings.some(f => f.kind === 'complexity' && f.line === 1));
  assert(report.findings.some(f => f.kind === 'clone' && f.otherInstances.length));
  assert.match(await readFile(first.details.textPath, 'utf8'), /JSX\/TSX/);
  assert.match(await readFile(first.details.textPath, 'utf8'), /complex_function/);
  assert.doesNotMatch(first.text, /baseline|Paper ref|published mean/i);
  assert.doesNotMatch(await readFile(first.details.textPath, 'utf8'), /baseline|Paper ref|published mean/i);
  assert.equal(Object.hasOwn(report, 'humanReference'), false);
  const pythonOnly = await analyzeSloppiness(join(repo, 'second.py'));
  assert.doesNotMatch(pythonOnly.text, /baseline|Paper ref|published mean/i);
  assert.equal(Object.hasOwn(pythonOnly.details, 'humanReference'), false);
  const single = await analyzeSloppiness(join(repo, 'sample.ts'));
  assert.equal(single.details.metrics.files_scanned, 1);
  assert.match(single.text, /Single file/);
  assert.equal(single.details.metrics.clone_loc, 0);
  const unsupported = await analyzeSloppiness(join(repo, 'unsupported.tsx'));
  assert.equal(unsupported.details.selection.selected, 0);
  assert.match(unsupported.text, /scores are unavailable/);
  await assert.rejects(analyzeSloppiness(join(repo, 'missing')), /ENOENT/);

  // Same snapshot/settings must give identical measurements and findings.
  const second = await analyzeSloppiness(repo);
  const repeated = JSON.parse(await readFile(second.details.reportPath, 'utf8'));
  assert.deepEqual(repeated.metrics, report.metrics);
  assert.deepEqual(repeated.findings, report.findings);

  // Test the renamed command, restored model tool, and report rendering.
  const pkg = process.env.PI_CODING_AGENT_PACKAGE;
  if (!pkg) {
    t.diagnostic('Pi registration checks skipped: set PI_CODING_AGENT_PACKAGE to the installed package directory.');
    return;
  }
  const { loadExtensions } = await import(pathToFileURL(join(pkg, 'dist/core/extensions/loader.js')));
  const loaded = await loadExtensions([resolve(import.meta.dirname, '../index.ts')], repo);
  assert.deepEqual(loaded.errors, []);
  const ext = loaded.extensions[0];
  assert.deepEqual([...ext.tools.keys()], ['code_sloppiness']);
  assert.deepEqual([...ext.commands.keys()], ['sloppiness', 'sloppiness:cancel']);
  assert.deepEqual([...ext.handlers.keys()], ['session_shutdown'], 'no prompt or context hooks');
  const entries = [];
  loaded.runtime.appendEntry = (kind, data) => entries.push({ kind, data });
  const notifications = [];
  const ctx = { cwd: repo, hasUI: true, ui: {
    notify: text => notifications.push(text), setStatus: () => {},
  } };
  await ext.commands.get('sloppiness').handler('"sample.ts"', ctx);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'sloppiness-report');
  assert.equal(entries[0].data.details.metrics.files_scanned, 1);
  const rendered = ext.entryRenderers.get('sloppiness-report')({ data: entries[0].data });
  assert(rendered.render(100).join('\n').includes('Code sloppiness:'));
  assert(ext.entryRenderers.has('quality-report'), 'historical reports retain their renderer');
  const tool = ext.tools.get('code_sloppiness').definition;
  const result = await tool.execute('test', { path: 'sample.ts' }, undefined, undefined, ctx);
  assert.equal(result.details.metrics.files_scanned, 1);
  assert.doesNotMatch(result.content[0].text, /baseline|Paper ref|published mean/i);
  assert.equal(Object.hasOwn(result.details, 'humanReference'), false);
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await assert.rejects(tool.execute('test', {}, alreadyAborted.signal, undefined, ctx), /abort/i);
  await ext.commands.get('sloppiness:cancel').handler('', ctx);
  assert.equal(entries.length, 1, 'manual scan appends one non-context report entry');
});

test('C-only and mixed repositories include headers, clones, and parse diagnostics', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pi-quality-c-test-'));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert(root.split(/[\\/]/).at(-1).startsWith('pi-quality-c-test-'));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, '.git'));
  const clone = name => `static inline int ${name}(int x) {\n    int doubled = x * 2;\n    int result = doubled + 3;\n    return result;\n}\n`;
  await writeFile(join(root, 'first.c'), clone('first'));
  await writeFile(join(root, 'inline.h'), `#ifndef INLINE_H\n#define INLINE_H\n${clone('second')}#endif\n`);
  const first = await analyzeSloppiness(root);
  const cOnly = JSON.parse(await readFile(first.details.reportPath, 'utf8'));
  assert.deepEqual(cOnly.languages, { c: 2 });
  assert.equal(cOnly.metrics.total_functions, 2);
  assert(cOnly.metrics.clone_loc > 0);
  assert.equal(cOnly.metrics.syntax_by_language.c.tree_count, 2);
  assert.equal(cOnly.cGrammarVersion, C_GRAMMAR_VERSION);
  assert.equal(cOnly.adapterVersion, 4);
  assert.equal(cOnly.diagnostics, '');
  assert(cOnly.findings.some(f => f.kind === 'clone' && f.otherInstances.some(i => i.file.endsWith('.h'))));

  await writeFile(join(root, 'template.h'), 'template<class T> T identity(T x) { return x; }\n');
  await writeFile(join(root, 'source.cpp'), 'int cpp_function() { return 42; }\n');
  const branches = Array.from({ length: 12 }, (_, i) => `    if (x == ${i}) result += ${i};`).join('\n');
  await writeFile(join(root, 'complex.c'), `int decisions(int x) {\n    int result = 0;\n${branches}\n    return result;\n}\n`);
  await writeFile(join(root, 'broken.c'), 'int broken( { return ;\n');
  await writeFile(join(root, 'ignored.c'), 'int ignored(void) { return 0; }\n');
  await writeFile(join(root, '.gitignore'), 'ignored.c\n');
  const mixed = await analyzeSloppiness(root);
  const report = JSON.parse(await readFile(mixed.details.reportPath, 'utf8'));
  assert.deepEqual(report.languages, { c: 3, cpp: 2 });
  assert.equal(report.metrics.files_scanned, 5);
  assert.equal(report.metrics.total_functions, 5);
  assert.equal(report.metrics.syntax_by_language.c.tree_count, 3);
  assert.equal(report.metrics.syntax_by_language.cpp.tree_count, 2);
  assert.equal(report.metrics.high_cc_functions, 1);
  assert(report.metrics.erosion > 0);
  assert.equal(report.findings.find(f => f.kind === 'complexity').complexity, 13);
  assert.match(report.diagnostics, /broken.c/);
  assert.match(mixed.text, /coverage may be incomplete/);
  assert.match(await readFile(mixed.details.textPath, 'utf8'), /Macros\/includes are not expanded/);
  const header = await analyzeSloppiness(join(root, 'inline.h'));
  assert.deepEqual(header.details.languages, { c: 1 });
  assert.equal(header.details.metrics.total_functions, 1);
  const cFile = await analyzeSloppiness(join(root, 'first.c'));
  assert.deepEqual(cFile.details.languages, { c: 1 });
  const broken = await analyzeSloppiness(join(root, 'broken.c'));
  assert.equal(broken.details.selection.failed, 1);
  assert.match(broken.text, /failed parsing/);
});

test('Git selection supports tracked ignores, globs, regex, all, and list-only', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pi-quality-selection-'));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert(root.split(/[\\/]/).at(-1).startsWith('pi-quality-selection-'));
    await rm(root, { recursive: true, force: true });
  });
  const init = await runProcess('git', ['init', '-q', root]);
  assert.equal(init.code, 0, init.stderr);
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'src', 'deep'));
  await mkdir(join(root, 'build'));
  await writeFile(join(root, '.gitignore'), 'ignored.c\ntracked.c\nbuild/\n');
  for (const file of ['src/first.c', 'src/deep/second.h', 'tracked.c', 'ignored.c', 'build/generated.c']) {
    await writeFile(join(root, file), 'int value(void) { return 1; }\n');
  }
  await writeFile(join(root, 'notes.txt'), 'unsupported');
  const add = await runProcess('git', ['-C', root, 'add', '-f', 'tracked.c']);
  assert.equal(add.code, 0, add.stderr);
  const listing = await analyzeSloppiness(root, { listOnly: true });
  assert.equal(listing.details.selection.method, 'git');
  assert.equal(listing.details.selection.selected, 3);
  assert.equal(listing.details.metrics.files_scanned, 0, 'list-only never parses sources');
  const all = await analyzeSloppiness(root, { listOnly: true, all: true });
  assert.equal(all.details.selection.selected, 5);
  const glob = await analyzeSloppiness(join(root, 'src', '**', '*.c'), { listOnly: true });
  assert.equal(glob.details.selection.selected, 1);
  const regex = await analyzeSloppiness(root, { regex: '^src/.*\\.(c|h)$', exclude: ['**/deep/**'], listOnly: true });
  assert.equal(regex.details.selection.selected, 1);
  const none = await analyzeSloppiness(root, { regex: 'does-not-exist', listOnly: true });
  assert.equal(none.details.selection.selected, 0);
  assert.match(none.text, /0 supported files selected/);
  await assert.rejects(analyzeSloppiness(root, { regex: '[' }), /Invalid file regex/);
});
