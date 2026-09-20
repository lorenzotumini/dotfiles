import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, utimes, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const testRoot = await mkdtemp(join(tmpdir(), 'pi-artifacts-test-'));
const oldTmp = process.env.TMPDIR;
process.env.TMPDIR = testRoot;
try {
  const { saveArtifact } = await import('../artifacts.mjs');
  const first = await saveArtifact('first', 'txt');
  assert.equal((await stat(first)).mode & 0o777, 0o600);
  assert.equal((await stat(join(first, '..'))).mode & 0o777, 0o700);
  await utimes(first, new Date(0), new Date(0));
  const next = await saveArtifact('next', 'md');
  await assert.rejects(stat(first), { code: 'ENOENT' });
  const paths = await Promise.all(Array.from({length:130}, () => saveArtifact('x', 'txt')));
  assert.equal(new Set(paths).size, paths.length);
  assert.equal((await readdir(join(next, '..'))).length, 128);
  await assert.rejects(stat(next), { code: 'ENOENT' });
  await assert.rejects(saveArtifact('invalid', '../txt'), /Invalid/);
  await assert.rejects(saveArtifact(Buffer.alloc(33 * 1024 * 1024)), /32 MiB/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(saveArtifact('aborted', 'txt', abort.signal));
  console.log('PASS: artifact permissions, expiry, count eviction, unique concurrent writes, size/type validation and cancellation');
} finally {
  if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTmp;
  await rm(testRoot, { recursive: true, force: true });
}
