// Limits/redaction shared by capture and tool output. No raw-output temp files.
export const MAX_OUTPUT_BYTES = 16 * 1024;
export const MAX_OUTPUT_LINES = 400;
export const REDACTED = '[redacted]';

export function clip(text, maxBytes, maxLines = 400) {
  const bytes = Buffer.from(String(text), 'utf8');
  const prefix = bytes.length > maxBytes
    ? new TextDecoder().decode(bytes.subarray(0, maxBytes), { stream: true })
    : String(text);
  return prefix.split('\n').slice(0, maxLines).join('\n');
}

export function bounded(text, maxBytes = MAX_OUTPUT_BYTES, maxLines = MAX_OUTPUT_LINES) {
  text = String(text);
  const truncated = Buffer.byteLength(text) > maxBytes || text.split('\n').length > maxLines;
  const notice = maxLines === 1 ? ' [truncated]' : '\n[Truncated; omitted content was not saved. Narrow the query/filter or return a smaller summary.]';
  return {
    text: truncated ? clip(text, maxBytes - Buffer.byteLength(notice), maxLines === 1 ? 1 : maxLines - 1) + notice : text,
    truncated,
  };
}

export function sensitiveName(name) {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return /authorization|cookie|apikey|token|secret|password|credential|signature|csrf|xsrf|session/.test(normalized)
    || ['key', 'code', 'sig', 'session', 'sessionid', 'auth', 'jwt'].includes(normalized);
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'about:'].includes(url.protocol)) return '[non-HTTP URL omitted]';
    if (url.username) url.username = REDACTED;
    if (url.password) url.password = REDACTED;
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveName(key)) url.searchParams.set(key, REDACTED);
    }
    if (url.hash) url.hash = REDACTED;
    return bounded(url.toString(), 1024, 1).text;
  } catch {
    return '[unparseable URL omitted]';
  }
}

export function safeHeaders(headers, baseUrl) {
  const result = Object.create(null);
  for (const [rawName, value] of Object.entries(headers).slice(0, 64)) {
    const name = rawName.toLowerCase();
    if (sensitiveName(name)) result[clip(name, 128, 1)] = REDACTED;
    else if (['location', 'referer', 'referrer', 'content-location'].includes(name)) {
      try { result[name] = safeUrl(new URL(value, baseUrl).href); }
      catch { result[name] = '[unparseable URL omitted]'; }
    } else result[clip(name, 128, 1)] = bounded(value, 256, 2).text;
  }
  if (Object.keys(headers).length > 64) result['[headers-truncated]'] = 'true';
  return result;
}

export function toolResult(text, details = {}) {
  const output = bounded(text);
  // Callers supply counts/status/paths only, never full entries or eval objects.
  return { content: [{ type: 'text', text: output.text }], details: { ...details, truncated: output.truncated } };
}
