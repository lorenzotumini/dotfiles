import { saveArtifact } from '../web-shared/artifacts.mjs';
// Narrow no-key adapter to Exa's documented hosted MCP search tool.
// No paid credentials, automatic retries, provider failover, or remote extraction fallback.
export const ENDPOINT = 'https://mcp.exa.ai/mcp';
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const MAX_OUTPUT_BYTES = 16 * 1024;
export const MAX_OUTPUT_LINES = 400;

export function bounded(text, bytes = MAX_OUTPUT_BYTES, lines = MAX_OUTPUT_LINES, savedPath) {
  text = String(text);
  const truncated = Buffer.byteLength(text) > bytes || text.split('\n').length > lines;
  if (!truncated) return { text, truncated: false };
  const notice = savedPath ? `\n[Truncated. Full result: ${savedPath}. Read selected ranges or search that file.]` : '\n[Truncated. Narrow the search or use web_fetch on a relevant URL.]';
  const prefix = new TextDecoder().decode(Buffer.from(text).subarray(0, bytes - Buffer.byteLength(notice)), { stream: true });
  return { text: prefix.split('\n').slice(0, lines - 1).join('\n') + notice, truncated: true };
}

function clean(value, max, name) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${name}: expected a string of at most ${max} characters.`);
  return value.trim().replace(/\s+/g, ' ');
}
function items(values, name) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 10) throw new Error(`Invalid ${name}: at most 10 strings allowed.`);
  return values.map(v => clean(v, 200, name).replace(/^"(.*)"$/, '$1')).filter(Boolean);
}
const quote = s => `"${s.replace(/"/g, '\\"')}"`;
export function buildQuery(args) {
  const query = clean(args.query, 2000, 'query');
  const exact = items(args.exactPhrases, 'exactPhrases');
  const excluded = items(args.excludeTerms, 'excludeTerms');
  if (!query && !exact.length) throw new Error("At least one of 'query' or 'exactPhrases' is required.");
  const count = args.count ?? 5;
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('count must be an integer from 1 to 10.');
  let site = clean(args.site, 2048, 'site').replace(/^site:/i, '');
  if (site) {
    let url;
    try { url = new URL(site.includes('://') ? site : `https://${site}`); }
    catch { throw new Error('Invalid site: use a domain or HTTP(S) URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw new Error('Invalid site: use a domain or HTTP(S) URL without credentials.');
    site = url.hostname + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, ''));
  }
  const composed = [query, ...exact.map(quote), ...excluded.map(s => `-${quote(s)}`), site ? `site:${site}` : ''].filter(Boolean).join(' ');
  if (composed.length > 4000) throw new Error('Combined search query exceeds 4000 characters.');
  return { query: composed, count };
}

export function buildFilters(args) {
  const filters = {};
  for (const key of ['includeDomains', 'excludeDomains']) {
    if (args[key] === undefined) continue;
    if (!Array.isArray(args[key]) || !args[key].length || args[key].length > 10) throw new Error(`${key}: use 1–10 domains`);
    filters[key] = args[key].map(value => {
      if (typeof value !== 'string' || value.length > 253 || !/^[a-z0-9.-]+$/i.test(value) || !value.includes('.') || value.includes('..')) throw new Error(`${key}: domain names only, no URLs/paths`);
      return value.toLowerCase();
    });
  }
  for (const key of ['startPublishedDate', 'endPublishedDate']) {
    const value = args[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error(`${key}: use a valid YYYY-MM-DD date`);
    filters[key] = value;
  }
  if (filters.startPublishedDate && filters.endPublishedDate && filters.startPublishedDate > filters.endPublishedDate) throw new Error('Publication date range is reversed');
  if (args.maxAgeHours !== undefined) {
    if (!Number.isInteger(args.maxAgeHours) || args.maxAgeHours < 0 || args.maxAgeHours > 8760) throw new Error('maxAgeHours must be an integer from 0 to 8760');
    filters.maxAgeHours = args.maxAgeHours;
  }
  return filters;
}

export function formatResults(raw, filters = {}) {
  let data;
  try { data = JSON.parse(raw); } catch { return raw; }
  if (!Array.isArray(data.results)) return raw;
  const domainMatches = (host, domains) => domains?.some(domain => host === domain || host.endsWith('.' + domain));
  return data.results.map((result, i) => {
    const warnings = [];
    let host;
    try { host = new URL(result.url).hostname; } catch { warnings.push('Invalid source URL'); }
    if (host && ((filters.includeDomains && !domainMatches(host, filters.includeDomains)) || domainMatches(host, filters.excludeDomains))) warnings.push('Provider returned a source outside the requested domain filters');
    const date = typeof result.publishedDate === 'string' ? result.publishedDate.slice(0, 10) : undefined;
    if (filters.startPublishedDate || filters.endPublishedDate) {
      if (!date) warnings.push('Publication date unavailable; date filter cannot be verified');
      else if ((filters.startPublishedDate && date < filters.startPublishedDate) || (filters.endPublishedDate && date > filters.endPublishedDate)) warnings.push('Publication date outside the requested range');
    }
    return [`[${i+1}] ${result.title || 'Untitled'}`, `URL: ${result.url || '(missing)'}`, date ? `Published: ${date}` : '',
      warnings.length ? `Warning: ${warnings.join('; ')}` : '',
      ...(Array.isArray(result.highlights) && result.highlights.length ? result.highlights : [result.text || ''])].filter(Boolean).join('\n');
  }).join('\n\n') || 'No results found.';
}

// Undefined means an unrelated MCP notification/response, not an empty search.
export function decodeMessage(payload) {
  const message = JSON.parse(payload);
  if (!message || message.id !== 1) return undefined;
  if (message.error) throw new Error(`Exa protocol error: ${bounded(message.error.message ?? 'unknown error', 1024, 15).text}`);
  const result = message.result;
  if (!result || !Array.isArray(result.content)) throw new Error('Malformed Exa result: missing content array.');
  if (result.isError) {
    const reason = result.content.find(c => c?.type === 'text' && typeof c.text === 'string')?.text ?? 'search failed';
    throw new Error(`Exa search failed: ${bounded(reason, 1024, 15).text}`);
  }
  if (!result.content.length) return 'No results found.';
  const texts = result.content.filter(c => c?.type === 'text' && typeof c.text === 'string').map(c => c.text);
  if (!texts.length) throw new Error('Exa returned no supported text content.');
  return texts.join('\n\n') || 'No results found.';
}

async function readResult(response, signal) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error('Exa response exceeded the 1 MiB download limit. Narrow the query.');
  }
  if (!response.body) throw new Error('Empty Exa response.');
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, {once:true});
  const decoder = new TextDecoder();
  const sse = response.headers.get('content-type')?.includes('text/event-stream');
  let buffer = '';
  let bytes = 0;
  function event(block) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data || data === '[DONE]') return undefined;
    return decodeMessage(data);
  }
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) { buffer += decoder.decode(); break; }
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('Exa response exceeded the 1 MiB download limit. Narrow the query.');
      buffer += decoder.decode(value, { stream: true });
      if (sse) {
        let delimiter;
        while ((delimiter = /\r?\n\r?\n/.exec(buffer))) {
          const block = buffer.slice(0, delimiter.index);
          buffer = buffer.slice(delimiter.index + delimiter[0].length);
          const text = event(block);
          if (text !== undefined) return text; // Don't wait for a persistent SSE connection to close.
        }
      }
    }
    const text = sse ? event(buffer) : decodeMessage(buffer);
    if (text === undefined) throw new Error('Exa returned no matching search response.');
    return text;
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function search(args, signal, fetchImpl = fetch) {
  const built = buildQuery(args);
  const filters = buildFilters(args);
  const advanced = Object.keys(filters).length > 0;
  const requestSignal = AbortSignal.any([AbortSignal.timeout(25_000), ...(signal ? [signal] : [])]);
  try {
    requestSignal.throwIfAborted();
    const response = await fetchImpl(advanced ? ENDPOINT + "?tools=web_search_advanced_exa" : ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: advanced ? 'web_search_advanced_exa' : 'web_search_exa', arguments: advanced ? {
          query: built.query, numResults: built.count, type: 'auto', textMaxCharacters: 2000, enableHighlights: true, highlightsMaxCharacters: 1200, ...filters,
        } : { query: built.query, numResults: built.count, type: 'auto', livecrawl: 'fallback', contextMaxCharacters: 8000 },
      } }),
      signal: requestSignal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new Error('Exa free-search rate limit reached. Wait before trying again; no paid fallback or automatic retry was used.');
      throw new Error(`Exa HTTP ${response.status}. No automatic retry or paid fallback was used.`);
    }
    const raw = await readResult(response, requestSignal);
    const text = formatResults(raw, filters);
    const fullOutputPath = bounded(text).truncated ? await saveArtifact(text, 'txt', requestSignal) : undefined;
    const output = bounded(text, MAX_OUTPUT_BYTES, MAX_OUTPUT_LINES, fullOutputPath);
    return { content: [{ type: 'text', text: output.text }], details: { provider: 'exa-free', requestedCount: built.count, truncated: output.truncated, fullOutputPath } };
  } catch (error) {
    if (signal?.aborted) throw new Error('Web search cancelled.');
    if (requestSignal.aborted) throw new Error('Exa search timed out after 25 seconds.');
    throw new Error(bounded(error instanceof Error ? error.message : String(error), 2048, 20).text);
  }
}
