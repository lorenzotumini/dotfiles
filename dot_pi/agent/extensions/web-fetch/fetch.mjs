import { Worker } from 'node:worker_threads';
import { saveArtifact } from '../web-shared/artifacts.mjs';
const MAX_BODY = 5 * 1024 * 1024;
const MAX_PDF = 20 * 1024 * 1024;

export async function parseInWorker(data, signal, timeoutMs = 15000) {
  signal?.throwIfAborted();
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: data, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 256 } });
  let timer, abort;
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(new Error('Extraction cancelled'));
      timer = setTimeout(() => reject(new Error('Extraction timed out')), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      worker.once('message', message => message.error ? reject(new Error(message.error)) : resolve(message.result));
      worker.once('error', reject);
      worker.once('exit', code => reject(new Error(`Extraction worker exited (${code})`)));
      if (signal?.aborted) abort();
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await worker.terminate(); // Stop CPU work too, not merely its awaiting promise.
  }
}

async function readBody(response, pdfHint, signal) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0, prefix = Buffer.alloc(0), limit;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.length;
      if (prefix.length < 1024) prefix = Buffer.concat([prefix, value.subarray(0, 1024-prefix.length)]);
      // Inspect the prefix even for generic MIME/download URLs; never trust Content-Length alone.
      if (pdfHint || prefix.includes(Buffer.from('%PDF-'))) limit = MAX_PDF;
      else if (prefix.length >= 1024) limit = MAX_BODY;
      if (size > (limit ?? MAX_BODY)) throw new Error(`Response too large (limit ${limit ?? MAX_BODY} bytes)`);
      if (limit && Number(response.headers.get('content-length')) > limit) throw new Error(`Response too large (limit ${limit} bytes)`);
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function localFetch(params, signal) {
  const { url, mode = 'readable', pages } = params;
  if (mode === 'render') {
    const { renderPage } = await import('../browser/render.mjs');
    const rendered = await renderPage(url, signal);
    return parseInWorker({ kind: 'html', body: rendered.html, url: rendered.url }, signal);
  }
  const response = await fetch(url, { signal, headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; PiWebFetch/1.0)',
    Accept: 'text/markdown,text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
  } });
  const finalUrl = response.url || url;
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}: ${response.statusText}`); }
  const type = (response.headers.get('content-type') || '').toLowerCase();
  const pdfHint = type.includes('application/pdf') || new URL(finalUrl).pathname.toLowerCase().endsWith('.pdf');
  const bytes = await readBody(response, pdfHint, signal);
  if (pdfHint || Buffer.from(bytes).subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    const originalPath = await saveArtifact(bytes, 'pdf', signal);
    try {
      const result = await parseInWorker({ kind: 'pdf', body: bytes, url: finalUrl, pages }, signal);
      result.details.originalPath = originalPath;
      result.content = `Original PDF: ${originalPath}\nUse pdf-reader with this local path for further pages, images, or OCR; no redownload needed.\n\n` + result.content;
      return result;
    } catch (error) { throw new Error(`${error.message}. Original PDF saved: ${originalPath}; use pdf-reader locally.`); }
  }
  if (/application\/(octet-stream|zip)|^(image|audio|video)\//.test(type)) throw new Error(`Unsupported content type: ${type.split(';')[0]}`);
  const text = new TextDecoder().decode(bytes);
  const html = /text\/html|application\/xhtml/.test(type) || (!type && /^\s*(<!doctype html|<html)/i.test(text));
  if (mode === 'raw' || !html) return { url: finalUrl, title: new URL(finalUrl).pathname.split('/').pop() || finalUrl, content: text, error: null, details: { extraction: mode === 'raw' ? 'raw' : 'text' } };
  return parseInWorker({ kind: 'html', body: text, url: finalUrl }, signal);
}

export async function fetchAndExtract(params, callerSignal) {
  const { url, allowJina = false, mode = 'readable' } = params;
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported');
  if (!['readable', 'raw', 'render'].includes(mode)) throw new Error('Invalid fetch mode');
  const signal = AbortSignal.any([AbortSignal.timeout(30000), ...(callerSignal ? [callerSignal] : [])]);
  try {
    signal.throwIfAborted();
    let result;
    try { result = await localFetch(params, signal); }
    catch (error) { result = { url, content: '', title: '', error: error.message }; }
    signal.throwIfAborted();
    if (!result.error) return result;
    if (/Response too large|Unsupported content type|Original PDF saved/.test(result.error)) return result;
    if (allowJina) {
      const response = await fetch('https://r.jina.ai/' + url, { signal, headers: { Accept: 'text/markdown', 'X-No-Cache': 'true' } });
      if (response.ok) {
        const text = new TextDecoder().decode(await readBody(response, false, signal));
        const start = text.indexOf('Markdown Content:');
        if (start >= 0) {
          const content = text.slice(start + 17).trim();
          if (content.length >= 100 && !/^(Loading|Please enable JavaScript)/.test(content)) return { url, title: '', content, error: null, details: { extraction: 'jina' } };
        }
      } else await response.body?.cancel();
    }
    return { ...result, error: result.error + '\nTry mode="raw" for source or mode="render" for local JS rendering. Jina fallback is ' + (allowJina ? 'unavailable.' : 'off; external fallback requires explicit user authorization.') };
  } catch (error) {
    if (callerSignal?.aborted) throw new Error('Aborted');
    if (signal.aborted) throw new Error('Fetch timed out after 30 seconds');
    throw error;
  }
}
