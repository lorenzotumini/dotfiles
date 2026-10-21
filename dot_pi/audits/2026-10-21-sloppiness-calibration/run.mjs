import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { runProcess } from '../../agent/extensions/sloppiness/core.mjs';

const here = import.meta.dirname;
const base = process.env.SLOPPINESS_CALIBRATION_CACHE ?? 'C:/Users/ltumi/.cache/pi-sloppiness-calibration/2026-10-21';
const adapterDir = resolve(here, '../../agent/extensions/sloppiness');
const reports = join(base, 'reports');
await mkdir(reports, { recursive: true });
const projects = [
  { name: 'redis', tag: '7.0.0', remote: 'https://github.com/redis/redis',
    options: { include: ['src/**/*.c', 'src/**/*.h'], exclude: ['src/modules/**', 'src/commands.c'] } },
  { name: 'lua', tag: 'v5.4.4', remote: 'https://github.com/lua/lua',
    options: { regex: '^[^/]+\\.[ch]$', exclude: ['ltests.c', 'ltests.h'] } },
  { name: 'zlib', tag: 'v1.2.12', remote: 'https://github.com/madler/zlib',
    options: { regex: '^[^/]+\\.[ch]$', exclude: ['crc32.h', 'inffixed.h', 'trees.h'] } },
  { name: 'linux-math', root: 'linux-sample/lib/math', revisionRoot: 'linux', tag: 'v5.18', remote: 'https://github.com/torvalds/linux',
    options: { regex: '\\.[ch]$' } },
  { name: 'linux-locking', root: 'linux-sample/kernel/locking', revisionRoot: 'linux', tag: 'v5.18', remote: 'https://github.com/torvalds/linux',
    options: { regex: '\\.[ch]$' } },
];
let results = [];
try { results = JSON.parse(await readFile(join(here, 'results.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const adapterHashes = {};
for (const name of ['analyze.py', 'c_parser.py', 'discovery.py']) {
  adapterHashes[name] = createHash('sha256').update(await readFile(join(adapterDir, name))).digest('hex');
}
for (const project of projects) {
  if (process.argv[2] && !project.name.startsWith(process.argv[2])) continue;
  const root = join(base, project.root ?? project.name);
  const revision = await runProcess('git', ['-C', join(base, project.revisionRoot ?? project.name), 'show', '-s', '--format=%H %cs', 'HEAD']);
  if (revision.code) throw new Error(revision.stderr);
  for (const recover of [false, true]) {
    const name = `${project.name}-${recover ? 'recover' : 'strict'}`;
    if (results.some(row => row.name === name)) continue;
    process.stdout.write(`Starting ${name}\n`);
    const reportPath = join(reports, `${name}.json`);
    const options = { ...project.options, recover };
    const started = Date.now();
    let row;
    try {
      const result = await runProcess(process.platform === 'win32' ? 'uv.exe' : 'uv', [
        '--no-config', 'tool', 'run', '--from', 'scb-check==0.2.0', '--with', 'tree-sitter-c==0.24.2',
        'python', '-I', '-B', '-X', 'utf8', join(here, 'calibrate.py'), join(adapterDir, 'analyze.py'),
        root, reportPath, JSON.stringify(options),
      ], { timeoutMs: 180_000 });
      if (result.code) throw new Error(result.stderr);
      row = { name, tag: project.tag, remote: project.remote, revision: revision.stdout.trim(),
        options, adapterHashes, wallSeconds: (Date.now() - started) / 1000,
        ...JSON.parse(result.stdout) };
    } catch (error) {
      row = { name, tag: project.tag, revision: revision.stdout.trim(), options, adapterHashes,
        wallSeconds: (Date.now() - started) / 1000, error: error.message };
    }
    results.push(row);
    await writeFile(join(here, 'results.json'), JSON.stringify(results, null, 2) + '\n');
    process.stdout.write(JSON.stringify(row.error ? { name, error: row.error.slice(-1200), seconds: row.wallSeconds } : {
      name, selected: row.selected, parsed: row.parsed, recovered: row.recovered,
      sloc: row.sloc, verbosity: row.verbosity, erosion: row.erosion,
      lineCoverage: row.parsedLineCoverage, seconds: row.wallSeconds, peakMiB: row.peakWorkingSetMiB,
    }) + '\n');
  }
}
