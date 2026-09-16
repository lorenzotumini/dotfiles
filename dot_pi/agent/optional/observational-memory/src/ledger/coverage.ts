import { isObservationsRecordedEntry, type Entry } from './types.js';
import { isSourceEntry } from './progress.js';

/** Exact chunk membership, not just the highest endpoint: parallel failures may
 * leave holes before a later successful chunk. Legacy endpoint-only records are
 * not treated as proof that an entire prefix was observed. */
export function recordedSourceIds(branch: Entry[], beforeEntryId?: string): Set<string> {
  const indexes = new Map(branch.map((entry, index) => [entry.id, index]));
  const cutoff = beforeEntryId === undefined ? branch.length : indexes.get(beforeEntryId);
  const covered = new Set<string>();
  if (cutoff === undefined) return covered;
  for (const entry of branch) {
    if (!isObservationsRecordedEntry(entry) || !entry.data.sourceEntryIds) continue;
    const end = indexes.get(entry.data.coversUpToId);
    if (end === undefined || end >= cutoff) continue;
    for (const id of entry.data.sourceEntryIds) {
      const index = indexes.get(id);
      if (index !== undefined && index <= end && isSourceEntry(branch[index])) covered.add(id);
    }
  }
  return covered;
}
export function contiguousCoverageMarker(branch: Entry[], pending: Iterable<{ sourceEntryIds?: string[] }> = []): string | undefined {
  const covered = recordedSourceIds(branch);
  for (const task of pending) for (const id of task.sourceEntryIds ?? []) covered.add(id);
  let last: string | undefined;
  for (const entry of branch) {
    if (!isSourceEntry(entry)) continue;
    if (!covered.has(entry.id)) break;
    last = entry.id;
  }
  return last;
}
export function hasCompleteCoverage(branch: Entry[], firstKeptId: string): boolean {
  const cutoff = branch.findIndex(entry => entry.id === firstKeptId);
  if (cutoff < 0) return false;
  const covered = recordedSourceIds(branch, firstKeptId);
  return branch.slice(0, cutoff).filter(isSourceEntry).every(entry => covered.has(entry.id));
}
