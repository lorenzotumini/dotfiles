// Narrow no-key adapter to Exa's documented hosted MCP search tool.
// No paid credentials, automatic retries, provider failover, or local result cache.
export const ENDPOINT = 'https://mcp.exa.ai/mcp';
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const MAX_OUTPUT_BYTES = 16 * 1024;
export const MAX_OUTPUT_LINES = 400;

export function bounded(text, bytes = MAX_OUTPUT_BYTES, lines = MAX_OUTPUT_LINES) {
  text = String(text);
  const truncated = Buffer.byteLength(text) > bytes || text.split('\n').length > lines;
  if (!truncated) return { text, truncated: false };
  const notice = '\n[Truncated. Narrow the search or use web_fetch on a relevant URL. Omitted content was not saved.]';
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
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function search(args, signal, fetchImpl = fetch) {
  const built = buildQuery(args);
  const requestSignal = AbortSignal.any([AbortSignal.timeout(25_000), ...(signal ? [signal] : [])]);
  try {
    requestSignal.throwIfAborted();
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'web_search_exa', arguments: {
          query: built.query, numResults: built.count, type: 'auto', livecrawl: 'fallback', contextMaxCharacters: 8000,
        },
      } }),
      signal: requestSignal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new Error('Exa free-search rate limit reached. Wait before trying again; no paid fallback or automatic retry was used.');
      throw new Error(`Exa HTTP ${response.status}. No automatic retry or paid fallback was used.`);
    }
    const output = bounded(await readResult(response, requestSignal));
    return { content: [{ type: 'text', text: output.text }], details: { provider: 'exa-free', requestedCount: built.count, truncated: output.truncated } };
  } catch (error) {
    if (signal?.aborted) throw new Error('Web search cancelled.');
    if (requestSignal.aborted) throw new Error('Exa search timed out after 25 seconds.');
    throw new Error(bounded(error instanceof Error ? error.message : String(error), 2048, 20).text);
  }
}
