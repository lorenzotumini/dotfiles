import { spawn, execFile } from 'node:child_process';
import { stat, realpath, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ANALYZER_VERSION = '0.2.0';
export const C_GRAMMAR_VERSION = '0.24.2';
const adapter = fileURLToPath(new URL('./analyze.py', import.meta.url));
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 16 * 1024;

export function commandPath(args) {
  const value = args.trim();
  if (!value) return '.';
  const first = value[0];
  if (first === '"' || first === "'") {
    if (value.length < 2 || value.at(-1) !== first) throw new Error('Close the quote around the path.');
    return value.slice(1, -1);
  }
  return value;
}

export function commandOptions(args) {
  const tokens = [];
  let i = 0;
  while (i < args.length) {
    if (/\s/.test(args[i])) { i++; continue; }
    const start = i;
    let value = '', quote;
    while (i < args.length && (quote || !/\s/.test(args[i]))) {
      const ch = args[i++];
      if (quote) { if (ch === quote) quote = undefined; else value += ch; }
      else if ((ch === '"' || ch === "'") && (!value || value.endsWith('='))) quote = ch;
      else value += ch;
    }
    if (quote) throw new Error('Close the quote around the path or filter.');
    tokens.push({ value, start });
  }
  const firstFlag = tokens.findIndex(token => token.value.startsWith('--'));
  if (firstFlag < 0) return { path: commandPath(args) };
  const result = { path: commandPath(args.slice(0, tokens[firstFlag].start)), include: [], exclude: [] };
  for (let j = firstFlag; j < tokens.length; j++) {
    const [flag, ...inline] = tokens[j].value.split('=');
    if (['--all', '--list', '--recover'].includes(flag)) {
      if (inline.length) throw new Error(`${flag} does not take a value.`);
      result[flag === '--list' ? 'listOnly' : flag.slice(2)] = true;
    } else if (['--include', '--exclude', '--regex'].includes(flag)) {
      const value = inline.length ? inline.join('=') : tokens[++j]?.value;
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a pattern.`);
      if (flag === '--regex') result.regex = value;
      else result[flag.slice(2)].push(value);
    } else throw new Error(`Unknown option ${flag}. Use /sloppiness --help.`);
  }
  return result;
}

// No shell: paths, spaces, and shell metacharacters stay literal arguments.
export function runProcess(command, args, { cwd, signal, timeoutMs = 180_000 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', UV_NO_PROGRESS: '1' },
    });
    let stdout = '', stderr = '', bytes = 0, failure;
    const stop = (error) => {
      if (failure) return;
      failure = error;
      if (!child.pid) return;
      if (process.platform === 'win32') {
        execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {});
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    };
    const abort = () => stop(new Error('Sloppiness scan cancelled.'));
    const timer = setTimeout(() => stop(new Error('Sloppiness scan exceeded the 3-minute timeout.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const collect = (chunk, isError) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BYTES) return stop(new Error('Sloppiness scan output exceeded 16 MiB. Narrow the scan to a subfolder.'));
      if (isError) stderr += chunk; else stdout += chunk;
    };
    child.stdout.on('data', chunk => collect(chunk, false));
    child.stderr.on('data', chunk => collect(chunk, true));
    child.on('error', error => { failure ??= error; });
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure); else resolveResult({ code, stdout, stderr });
    });
  });
}

function plain(value) {
  // Findings and paths can contain terminal escape sequences or line breaks.
  return String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}

export function formatReport(report, limit = Infinity) {
  const m = report.metrics;
  const pct = value => `${(value * 100).toFixed(1)}%`;
  const base = report.scope === 'file' ? dirname(report.target) : report.target;
  const loc = item => `${plain(relative(base, item.file) || item.file)}:${item.line}`;
  const lines = [
    `Code sloppiness: ${plain(report.target)}`,
    `scb-check ${report.version} · adapter ${report.adapterVersion ?? 1} · ${m.files_scanned} files · ${m.total_loc} source lines · ${m.total_functions} functions`,
    `Languages (parsed files): ${Object.entries(report.languages).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `Verbosity: ${m.files_scanned ? pct(m.verbosity) : 'N/A'} (${m.verbosity_flagged_loc} flagged lines; overlapping findings counted once)`,
    `Erosion: ${m.total_mass > 0 ? pct(m.erosion) : 'N/A (no function mass)'} (${m.high_cc_functions} functions with complexity > 10)`,
    `Flagged lines by source: clones ${m.clone_loc}, patterns ${m.ast_grep_flagged_loc}, structural rules ${m.structural_rule_loc}`,
    'Coverage: Python has pattern + structural rules; other supported languages (including C) have clone-based verbosity. Unsupported extensions are not analyzed (including JSX/TSX, Go, Java, and shell).',
    report.scope === 'file' ? 'Scope: one file; duplication outside this file is not checked.' : 'Scope: folder recursively; recorded selection options and exclusions apply. Tests are included unless excluded.',
  ];
  if (report.selection) {
    const s = report.selection;
    lines.push(`Discovery: ${s.method}; ${s.discovered} visible candidates; ${s.selected.length} selected; ${s.failed.length} parse failures; ${Object.keys(s.recovered).length} recovered files.`,
      `Filters: ${JSON.stringify(s.options)}`, `Exclusion counts: ${JSON.stringify(s.skipCounts)}`, s.ignorePolicy);
  }
  if (report.languages.c || report.files?.some(file => /\.h$/i.test(file))) {
    lines.push(`C grammar: tree-sitter-c ${report.cGrammarVersion}. .h files try C, then C++ on syntax failure. Macros/includes are not expanded; all conditional-compilation branches are analyzed as written. C complexity counts non-default switch cases, loops, if/ternary expressions, and &&/|| operators.`);
  }
  if (report.diagnostics.trim()) lines.push(`Analyzer diagnostics — coverage may be incomplete:\n${plain(report.diagnostics)}`);
  if (report.selection) {
    lines.push('', 'Selected files:', ...report.selection.selected.map(file => `  ${plain(relative(base, file) || file)}`));
    if (report.selection.failed.length) lines.push('', 'Parse failures:', ...report.selection.failed.map(file => `  ${plain(relative(base, file) || file)}`));
    lines.push('', 'Skipped files:', ...report.selection.skipped.map(item => `  ${plain(relative(base, item.file) || item.file)} — ${item.reason}`));
  }
  lines.push('', `Findings (${report.findings.length}):`);
  for (const item of report.findings.slice(0, limit)) {
    if (item.kind === 'complexity') {
      lines.push(`  ${loc(item)} — complexity ${item.complexity}, ${item.sloc} SLOC — ${plain(item.name)}`);
    } else if (item.kind === 'clone') {
      const others = item.otherInstances.map(loc).join(', ');
      lines.push(`  ${loc(item)}-${item.endLine} — duplicate block; also ${others}`);
    } else {
      lines.push(`  ${loc(item)} — ${plain(item.rule)}: ${plain(item.message)}`);
    }
  }
  if (!report.findings.length) lines.push('  No findings in the analyzed scope.');
  if (report.findings.length > limit) lines.push(`  ${report.findings.length - limit} more findings in the saved report.`);
  lines.push('', 'Scores are review signals; they do not establish correctness or overall design quality.');
  return lines.join('\n');
}

export function formatSummary(report) {
  const m = report.metrics;
  const pct = value => `${(value * 100).toFixed(1)}%`;
  const base = report.scope === 'file' ? dirname(report.target) : report.target;
  const loc = item => `${plain(relative(base, item.file) || item.file)}:${item.line}`;
  const s = report.selection;
  if (report.listOnly || !m.files_scanned) {
    const selected = s?.selected ?? [];
    return [
      `Sloppiness selection: ${plain(report.target)}`,
      `${selected.length} supported files selected · ${s?.skipped.length ?? 0} skipped · discovery: ${s?.method ?? 'unknown'}`,
      ...(report.listOnly ? [] : [`No files were analyzed; scores are unavailable.${s?.failed.length ? ` ${s.failed.length} files failed parsing. Try --recover for approximate C analysis.` : ' Check filters, ignored files (--all), and supported extensions.'}`]),
      ...selected.slice(0, 8).map(file => `  ${plain(relative(base, file) || file)}`),
      ...(selected.length > 8 ? [`  ${selected.length - 8} more in the full report.`] : []),
    ].join('\n');
  }
  const lines = [
    `Code sloppiness: ${plain(report.target)}`,
    `${m.files_scanned} supported files · ${m.total_loc.toLocaleString('en-US')} SLOC · ${Object.keys(report.languages).join(', ')}`,
    `Verbosity ${pct(m.verbosity)} · Erosion ${m.total_mass > 0 ? pct(m.erosion) : 'N/A'} · ${m.high_cc_functions} complex functions`,
  ];
  if (s) lines.push(`Selection: ${s.selected.length} selected · ${s.skipped.length} skipped${s.failed.length ? ` · ${s.failed.length} parse failures` : ''}`);
  if (s && Object.keys(s.recovered).length) lines.push(`Approximate: syntax recovery used for ${Object.keys(s.recovered).length} C files.`);
  if (Object.keys(report.languages).some(language => language !== 'python')) {
    lines.push('Non-Python verbosity measures duplication only.');
  }
  if (report.scope === 'file') lines.push('Single file; duplicates elsewhere are not checked.');
  if (report.diagnostics.trim()) lines.push('Warning: analyzer reported issues; coverage may be incomplete. See full report.');
  if (report.findings.length) lines.push('', `Top findings (${Math.min(3, report.findings.length)} of ${report.findings.length}):`);
  else lines.push('', 'No findings in the analyzed scope.');
  for (const item of report.findings.slice(0, 3)) {
    if (item.kind === 'complexity') {
      lines.push(`  ${loc(item)} — complexity ${item.complexity}, ${item.sloc} SLOC`);
    } else if (item.kind === 'clone') {
      const other = item.otherInstances[0];
      lines.push(`  ${loc(item)} — duplicate${other ? ` of ${loc(other)}` : ' block'}`);
    } else {
      lines.push(`  ${loc(item)} — ${plain(item.rule)}`);
    }
  }
  return lines.join('\n');
}

export async function analyzeSloppiness(path = '.', { cwd = process.cwd(), signal, ...options } = {}) {
  signal?.throwIfAborted();
  const expanded = path === '~' ? homedir() : /^~[\\/]/.test(path) ? join(homedir(), path.slice(2)) : path;
  const absolute = resolve(cwd, expanded);
  let target;
  try { target = await realpath(absolute); }
  catch (error) {
    const marker = absolute.search(/[*?\[]/);
    if (error.code !== 'ENOENT' || marker < 0) throw error;
    const separator = Math.max(absolute.lastIndexOf('/', marker), absolute.lastIndexOf('\\', marker));
    target = await realpath(absolute.slice(0, separator + 1));
    options.pathGlob = absolute.slice(separator + 1).replaceAll('\\', '/');
  }
  const info = await stat(target);
  if (!info.isDirectory() && !info.isFile()) throw new Error('Choose a source file or directory.');
  let result;
  try {
    result = await runProcess(process.platform === 'win32' ? 'uv.exe' : 'uv', [
      '--no-config', 'tool', 'run', '--from', `scb-check==${ANALYZER_VERSION}`,
      '--with', `tree-sitter-c==${C_GRAMMAR_VERSION}`,
      'python', '-I', '-B', '-X', 'utf8', adapter, target, JSON.stringify(options),
    ], { cwd: info.isDirectory() ? target : dirname(target), signal });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Sloppiness scans require uv on PATH. Install uv, restart Pi, and retry /sloppiness.');
    throw error;
  }
  if (result.code !== 0) throw new Error(`Sloppiness analyzer failed (${result.code}):\n${plain(result.stderr).slice(-6000)}`);
  let report;
  try { report = JSON.parse(result.stdout); }
  catch { throw new Error('Sloppiness analyzer returned invalid JSON.'); }
  if (report.schemaVersion !== 1 || report.version !== ANALYZER_VERSION || !Array.isArray(report.findings)) {
    throw new Error('Unsupported sloppiness analyzer report.');
  }
  report.scope = info.isDirectory() ? 'folder' : 'file';
  report.analyzedAt = new Date().toISOString();
  signal?.throwIfAborted();
  const artifactDir = await mkdtemp(join(tmpdir(), 'pi-sloppiness-'));
  const reportPath = join(artifactDir, 'report.json');
  const textPath = join(artifactDir, 'report.txt');
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600, signal });
  await writeFile(textPath, `${formatReport(report)}\n\nStructured report: ${plain(reportPath)}\n`, { mode: 0o600, signal });
  let preview = formatSummary(report);
  if (Buffer.byteLength(preview) > MAX_PREVIEW_BYTES) {
    preview = new TextDecoder().decode(Buffer.from(preview).subarray(0, MAX_PREVIEW_BYTES), { stream: true }) + '\n[Preview truncated.]';
  }
  const text = `${preview}\n\nFull report: ${plain(textPath)}`;
  return { text, details: {
    target, analyzer: report.analyzer, version: report.version,
    adapterVersion: report.adapterVersion, cGrammarVersion: report.cGrammarVersion, metrics: report.metrics,
    languages: report.languages, findingCount: report.findings.length, reportPath, textPath,
    selection: report.selection ? {
      selected: report.selection.selected.length, skipped: report.selection.skipped.length,
      failed: report.selection.failed.length, recovered: Object.keys(report.selection.recovered).length,
      method: report.selection.method,
    } : undefined,
    diagnostics: plain(report.diagnostics).slice(0, 2000),
  } };
}
