import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';

const path = new URL('./results.json', import.meta.url);
const rows = JSON.parse(await readFile(path, 'utf8'));
for (const row of rows) {
  if (row.error) continue;
  const report = JSON.parse(await readFile(row.reportPath, 'utf8'));
  const parsed = new Set(report.files);
  const coverage = {};
  for (const suffix of ['.c', '.h']) {
    const selected = report.selection.selected.filter(file => extname(file) === suffix);
    let lines = 0, parsedLines = 0;
    for (const file of selected) {
      const text = await readFile(file, 'utf8');
      const count = text ? text.split(/\r\n|\n|\r/).length - (/[\r\n]$/.test(text) ? 1 : 0) : 0;
      lines += count;
      if (parsed.has(file)) parsedLines += count;
    }
    coverage[suffix] = {
      selectedFiles: selected.length, parsedFiles: selected.filter(file => parsed.has(file)).length,
      physicalLines: lines, parsedPhysicalLines: parsedLines,
      lineCoverage: lines ? parsedLines / lines : null,
      recoveredFiles: selected.filter(file => file in report.selection.recovered).length,
    };
  }
  row.sourceCoverage = coverage;
  row.recoveredSyntaxErrorNodes = Object.values(report.selection.recovered).reduce((sum, n) => sum + n, 0);
}
await writeFile(path, JSON.stringify(rows, null, 2) + '\n');
const header = ['name', 'tag', 'selected', 'parsed', 'source_C_line_coverage', 'recovered', 'SLOC', 'verbosity_pct', 'erosion_pct', 'wall_seconds', 'peak_MiB'];
const lines = rows.filter(row => !row.error).map(row => [
  row.name, row.tag, row.selected, row.parsed,
  (row.sourceCoverage['.c'].lineCoverage * 100).toFixed(1), row.recovered, row.sloc,
  row.parsed ? (row.verbosity * 100).toFixed(2) : '', row.erosion === null ? '' : (row.erosion * 100).toFixed(2),
  row.wallSeconds.toFixed(2), row.peakWorkingSetMiB.toFixed(1),
]);
await writeFile(new URL('./results.csv', import.meta.url), [header, ...lines].map(row => row.join(',')).join('\n') + '\n');
console.log([header, ...lines].map(row => row.join(' | ')).join('\n'));
