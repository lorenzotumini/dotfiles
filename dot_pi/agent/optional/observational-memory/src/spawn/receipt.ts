import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { atomicWrite, readMemoryText, resolveWithinMemory } from '../memory/paths.js';

export function readSmallJson(path: string, maxBytes = 256 * 1024): any {
  if (!resolveWithinMemory(path, '.')) throw new Error('IPC path contains a symlink');
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error('IPC file is not regular or exceeds its limit');
  return JSON.parse(readFileSync(path, 'utf8'));
}
export function requireWorkerSuccess(path: string): void {
  const status = readSmallJson(path, 8192);
  if (status?.ok !== true) throw new Error('Worker did not finish successfully (missing/failed assistant turn)');
}
export function topicDigest(root: string, path: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,80}\.md$/.test(path) || path.toLowerCase() === 'index.md') {
    throw new Error('Receipt must reference a top-level topic .md file, not generated metadata');
  }
  const text = readMemoryText(root, path);
  if (!text.trim()) throw new Error('Receipt references an empty topic');
  return createHash('sha256').update(text).digest('hex');
}
export type ConsolidationReceipt = {
  observationTimestamps: string[];
  files: { path: string; sha256: string }[];
};
export function writeConsolidationReceipt(path: string, receipt: ConsolidationReceipt): void {
  atomicWrite(path, JSON.stringify(receipt));
}
export function verifyConsolidationReceipt(root: string, path: string, expected: Set<string>): string[] {
  const result = readSmallJson(path);
  const ids = result?.observationTimestamps;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 ||
      ids.some(id => typeof id !== 'string' || !expected.has(id)) || new Set(ids).size !== ids.length) {
    throw new Error('Consolidation receipt has missing, duplicate, or unrelated observation IDs');
  }
  if (!Array.isArray(result.files) || result.files.length === 0 || result.files.length > 100) {
    throw new Error('Consolidation receipt has no durable topic files');
  }
  for (const file of result.files) {
    if (typeof file?.path !== 'string' || typeof file.sha256 !== 'string' || topicDigest(root, file.path) !== file.sha256) {
      throw new Error('Consolidation receipt does not match durable topic contents');
    }
  }
  return ids;
}
