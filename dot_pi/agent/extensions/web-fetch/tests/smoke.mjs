// Offline regression tests. Mocked HTTP responses never contact external services.
import assert from 'node:assert/strict';
import { readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const besideNode = resolve(dirname(process.execPath), '../lib/node_modules/@earendil-works/pi-coding-agent');
let piDir = process.env.PI_CODING_AGENT_PACKAGE ?? besideNode;
if (!existsSync(piDir)) {
  const env = { ...process.env }; delete env.npm_config_prefix;
  piDir = join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', env }).trim(), '@earendil-works/pi-coding-agent');
}
const { loadExtensions } = await import(pathToFileURL(join(piDir, 'dist/core/extensions/loader.js')));
const entry = resolve(dirname(fileURLToPath(import.meta.url)), '../index.ts');
const loaded = await loadExtensions([entry], process.cwd());
assert.deepEqual(loaded.errors, []);
const tool = loaded.extensions[0].tools.get('web_fetch').definition;
const originalFetch = globalThis.fetch;
const files = [];
let checks = 0;
const limit = 24 * 1024;

async function run(fetch, url = 'https://example.test/article', signal, allowJina) {
  globalThis.fetch = fetch;
  const result = await tool.execute('test', { url, allowJina }, signal);
  const text = result.content[0].text;
  assert.ok(Buffer.byteLength(text) <= limit, 'text byte ceiling');
  assert.ok(text.split('\n').length <= 600, 'line ceiling');
  assert.ok(Buffer.byteLength(JSON.stringify(result.details)) < 4096, 'no hidden full text in metadata');
  if (result.details.fullOutputPath) files.push(result.details.fullOutputPath);
  checks++;
  return result;
}
function textResponse(text, headers = {}) {
  return new Response(text, { headers: { 'content-type': 'text/plain', ...headers } });
}
function oversized(headers = {}, max = 5 * 1024 * 1024) {
  let sent = 0;
  let cancelled = false;
  const response = new Response(new ReadableStream({
    pull(controller) {
      if (sent >= max + 1024 * 1024) { controller.close(); return; }
      sent += 64 * 1024;
      controller.enqueue(new Uint8Array(64 * 1024));
    },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'text/plain', ...headers } });
  return { response, cancelled: () => cancelled };
}
function pdfFixture() {
  const stream = 'BT /F1 12 Tf 72 720 Td (PDF smoke test) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return body;
}
try {
  const small = await run(async () => textResponse('Small document'));
  assert.equal(small.content[0].text, '# article\n\nSource: https://example.test/article\n\n---\n\nSmall document');
  assert.equal(small.details.truncated, false);
  assert.equal(small.details.fullOutputPath, undefined);

  for (const content of ['word '.repeat(100000), 'short line\n'.repeat(1500), '🚀漢字'.repeat(20000)]) {
    const result = await run(async () => textResponse(content));
    assert.equal(result.details.truncated, true);
    assert.match(result.content[0].text, /Output truncated/);
    assert.ok(!result.content[0].text.includes('\ufffd'), 'no broken UTF-8');
    const saved = await readFile(result.details.fullOutputPath, 'utf8');
    assert.ok(saved.endsWith(content), 'full text preserved');
    assert.equal((await stat(result.details.fullOutputPath)).mode & 0o777, 0o600);
  }
  const giantTitle = await run(async () => textResponse('# ' + 'title'.repeat(20000) + '\nbody'));
  assert.ok(Buffer.byteLength(giantTitle.details.title) <= 512);

  const html = `<html><head><title>Article</title></head><body><article><h1>Article</h1>${'<p>Transformers use attention to process sequences. '.repeat(10) + '</p>'}${'<p>Long article paragraph about neural networks and attention mechanisms.</p>'.repeat(3000)}</article></body></html>`;
  const article = await run(async () => new Response(html, { headers: { 'content-type': 'text/html' } }));
  assert.equal(article.details.truncated, true);
  assert.ok((await readFile(article.details.fullOutputPath, 'utf8')).length > limit);

  for (const optIn of [undefined, false]) {
    let calls = 0;
    await assert.rejects(run(async url => {
      calls++; assert.ok(!String(url).startsWith('https://r.jina.ai/'));
      return new Response('', {status:403});
    }, undefined, undefined, optIn), /Jina fallback is off/);
    assert.equal(calls, 1); checks++;
  }
  let successCalls = 0;
  await run(async () => { successCalls++; return textResponse('success'); }, undefined, undefined, true);
  assert.equal(successCalls, 1);
  let shortCalls = 0;
  const short = await run(async () => {
    shortCalls++;
    return new Response('<html><body><article><h1>Example</h1><p>A short public article.</p></article></body></html>', {headers:{'content-type':'text/html'}});
  });
  assert.match(short.content[0].text, /may be incomplete/);
  assert.equal(shortCalls, 1);
  let jinaCalls = 0;
  const jina = await run(async url => {
    if (String(url).startsWith('https://r.jina.ai/')) {
      jinaCalls++;
      return textResponse('Title: fallback\nMarkdown Content:\n# Fallback\n' + 'fallback '.repeat(20000));
    }
    return new Response('', { status: 403 });
  }, undefined, undefined, true);
  assert.equal(jinaCalls, 1);
  assert.equal(jina.details.truncated, true);

  for (const headers of [{}, { 'content-length': '1' }, { 'content-length': '999999999' }]) {
    const body = oversized(headers); let calls = 0;
    await assert.rejects(run(async () => { calls++; return body.response; }), /Response too large/);
    assert.equal(calls, 1, 'do not retry oversized bodies via Jina');
    assert.equal(body.cancelled(), true);
    checks++;
  }
  const jinaBody = oversized();
  await assert.rejects(run(async url => String(url).startsWith('https://r.jina.ai/') ? jinaBody.response : new Response('', { status: 403 }), undefined, undefined, true), /Response too large/);
  assert.equal(jinaBody.cancelled(), true); checks++;

  const pdf = await run(async () => new Response(pdfFixture(), { headers: { 'content-type': 'application/pdf' } }));
  assert.match(pdf.content[0].text, /PDF smoke test/);
  const bigPdf = oversized({ 'content-type': 'application/pdf' }, 20 * 1024 * 1024);
  await assert.rejects(run(async () => bigPdf.response), /Response too large/);
  assert.equal(bigPdf.cancelled(), true); checks++;

  await assert.rejects(run(async () => { throw new Error('must not fetch'); }, 'file:///tmp/test'), /Only HTTP and HTTPS/); checks++;
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(run(async () => { throw new Error('must not fetch'); }, 'https://example.test', aborted.signal), /Aborted/); checks++;
  try {
    await run(async () => { throw new Error('huge error'.repeat(10000)); });
    assert.fail('expected error');
  } catch (error) { assert.ok(Buffer.byteLength(error.message) <= 2048); checks++; }
  console.log(`PASS: ${checks} cases; byte/line limits, UTF-8, private full-text files, metadata, HTML, Jina, PDF, body cancellation, invalid URLs and errors.`);
} finally {
  globalThis.fetch = originalFetch;
  for (const file of files) await rm(dirname(file), { recursive: true, force: true });
}
