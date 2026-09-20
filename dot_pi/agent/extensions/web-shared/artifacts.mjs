import { mkdir, lstat, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Shared by search/fetch. Only our generated regular files are eligible for eviction.
const root = join(tmpdir(), `pi-web-artifacts-${process.getuid?.() ?? 'user'}`);
const maxBytes = 128 * 1024 * 1024;
let queue = Promise.resolve();
export function saveArtifact(data, extension = 'txt', signal) {
  const job = queue.then(async () => {
    signal?.throwIfAborted();
    if (!/^(txt|md|html|pdf|json)$/.test(extension)) throw new Error('Invalid artifact type');
    const size = Buffer.byteLength(data);
    if (size > 32 * 1024 * 1024) throw new Error('Artifact exceeds 32 MiB limit');
    await mkdir(root, { mode: 0o700, recursive: true });
    const info = await lstat(root);
    if (!info.isDirectory() || (info.mode & 0o777) !== 0o700 ||
        (process.getuid && info.uid !== process.getuid())) throw new Error('Unsafe web artifact directory');
    const files = [];
    for (const name of await readdir(root)) {
      if (!/^[0-9a-f-]{36}\.(txt|md|html|pdf|json)$/.test(name)) continue;
      const path = join(root, name);
      const stat = await lstat(path).catch(() => null);
      if (stat?.isFile()) files.push({ path, size: stat.size, time: stat.mtimeMs });
    }
    files.sort((a, b) => a.time - b.time);
    let bytes = files.reduce((n, f) => n + f.size, size);
    let count = files.length + 1;
    for (const file of files) {
      if (Date.now() - file.time > 86400000 || bytes > maxBytes || count > 128) {
        await unlink(file.path).catch(() => {});
        bytes -= file.size; count--;
      }
    }
    const path = join(root, `${randomUUID()}.${extension}`);
    try {
      await writeFile(path, data, { mode: 0o600, flag: 'wx', signal });
      return path;
    } catch (error) {
      await unlink(path).catch(() => {});
      throw error;
    }
  });
  queue = job.catch(() => {});
  return job;
}
