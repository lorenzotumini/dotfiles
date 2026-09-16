// Cap model-facing completion text independently of a child's requested brevity.
export function boundedText(text, maxBytes = 16 * 1024, maxLines = 400) {
  text = String(text ?? '');
  if (Buffer.byteLength(text) <= maxBytes && text.split('\n').length <= maxLines) return text;
  const suffix = '\n\n[Truncated. Full output remains in the child session.]';
  const budget = maxBytes - Buffer.byteLength(suffix);
  const head = text.split('\n').slice(0, maxLines - 3).join('\n');
  let clipped = Buffer.from(head).subarray(0, budget).toString('utf8');
  while (Buffer.byteLength(clipped) > budget) clipped = clipped.slice(0, -1);
  return clipped + suffix;
}
