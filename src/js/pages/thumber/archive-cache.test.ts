import { assert } from 'chai';
import { createArchiveCache, ArchiveFiles } from './archive.js';

// A fake archive: entryName → uncompressed size. blob() decompression is counted so
// tests can assert single-entry, cache-served behavior.
type FakeArchive = Record<string, number>;

function makeEnv(archives: Record<string, FakeArchive>) {
  const stats = new Map<string, { mtimeMs: number; size: number }>();
  let decompressCount = 0;
  const blobCounts: Record<string, number> = {};

  for (const name of Object.keys(archives)) {
    stats.set(name, { mtimeMs: 1, size: 100 });
  }

  const stat = async (filename: string) => {
    const st = stats.get(filename);
    if (!st) throw new Error(`ENOENT: ${filename}`);
    return st;
  };

  const decompress = async (filename: string): Promise<ArchiveFiles> => {
    decompressCount++;
    const entries = archives[filename];
    const out: ArchiveFiles = {};
    for (const [entryName, size] of Object.entries(entries)) {
      out[entryName] = {
        type: 'image/jpeg',
        size,
        mtime: 1,
        blob: async () => {
          blobCounts[`${filename}/${entryName}`] = (blobCounts[`${filename}/${entryName}`] ?? 0) + 1;
          return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
        },
      };
    }
    return out;
  };

  return {
    stat,
    decompress,
    setMtime: (name: string, mtimeMs: number) => stats.set(name, { ...stats.get(name)!, mtimeMs }),
    decompressCount: () => decompressCount,
    blobCount: (name: string, entry: string) => blobCounts[`${name}/${entry}`] ?? 0,
  };
}

describe('createArchiveCache', () => {
  it('reads the central directory once and serves repeats from cache', async () => {
    const env = makeEnv({ '/a.zip': { 'x.jpg': 10 } });
    const cache = createArchiveCache(env);
    await cache.getArchive('/a.zip');
    await cache.getArchive('/a.zip');
    assert.strictEqual(env.decompressCount(), 1, 'directory read only once');
  });

  it('dedupes concurrent reads of the same archive into one decompress', async () => {
    const env = makeEnv({ '/a.zip': { 'x.jpg': 10 } });
    const cache = createArchiveCache(env);
    await Promise.all([cache.getArchive('/a.zip'), cache.getArchive('/a.zip'), cache.getArchive('/a.zip')]);
    assert.strictEqual(env.decompressCount(), 1, 'in-flight requests share one decompress');
  });

  it('re-reads when the archive mtime changes, and drops the stale version', async () => {
    const env = makeEnv({ '/a.zip': { 'x.jpg': 10 } });
    const cache = createArchiveCache(env);
    await cache.getArchive('/a.zip');
    assert.strictEqual(env.decompressCount(), 1);

    env.setMtime('/a.zip', 999);
    await cache.getArchive('/a.zip');
    assert.strictEqual(env.decompressCount(), 2, 'changed archive → re-read');
    assert.strictEqual(cache._dirCacheSize(), 1, 'stale version evicted, not accumulated');
  });

  it('evicts the least-recently-used archive beyond maxArchives', async () => {
    const env = makeEnv({ '/a.zip': { 'x.jpg': 1 }, '/b.zip': { 'x.jpg': 1 }, '/c.zip': { 'x.jpg': 1 } });
    const cache = createArchiveCache({ ...env, maxArchives: 2 });
    await cache.getArchive('/a.zip');
    await cache.getArchive('/b.zip');
    await cache.getArchive('/c.zip'); // evicts /a.zip (LRU)
    assert.strictEqual(cache._dirCacheSize(), 2);
    assert.strictEqual(env.decompressCount(), 3);

    await cache.getArchive('/b.zip'); // still cached → no read
    assert.strictEqual(env.decompressCount(), 3);
    await cache.getArchive('/a.zip'); // evicted → re-read
    assert.strictEqual(env.decompressCount(), 4);
  });

  it('getArchiveEntryBytes decompresses only the requested entry, then caches it', async () => {
    const env = makeEnv({ '/a.zip': { 'x.jpg': 10, 'y.jpg': 20 } });
    const cache = createArchiveCache(env);

    const first = await cache.getArchiveEntryBytes('/a.zip', 'x.jpg');
    assert.ok(first);
    assert.strictEqual(first!.bytes.byteLength, 10);
    assert.strictEqual(first!.type, 'image/jpeg');
    assert.strictEqual(env.blobCount('/a.zip', 'x.jpg'), 1, 'only x decompressed');
    assert.strictEqual(env.blobCount('/a.zip', 'y.jpg'), 0, 'y never touched');

    await cache.getArchiveEntryBytes('/a.zip', 'x.jpg');
    assert.strictEqual(env.blobCount('/a.zip', 'x.jpg'), 1, 'second view served from byte cache');
  });

  it('returns null for an entry that is not in the archive', async () => {
    const env = makeEnv({ '/a.zip': { 'x.jpg': 10 } });
    const cache = createArchiveCache(env);
    assert.isNull(await cache.getArchiveEntryBytes('/a.zip', 'nope.jpg'));
  });

  it('evicts decompressed bytes once over the byte budget', async () => {
    const env = makeEnv({ '/a.zip': { 'x.jpg': 60, 'y.jpg': 60 } });
    const cache = createArchiveCache({ ...env, maxBytes: 100 });

    await cache.getArchiveEntryBytes('/a.zip', 'x.jpg');
    await cache.getArchiveEntryBytes('/a.zip', 'y.jpg'); // 120 > 100 → evict x
    assert.strictEqual(cache._bytesTotal(), 60, 'only the newest entry kept');

    await cache.getArchiveEntryBytes('/a.zip', 'x.jpg'); // x was evicted → re-decompress
    assert.strictEqual(env.blobCount('/a.zip', 'x.jpg'), 2);
  });

  it('re-decompressing bytes after an archive change does not double-count the budget', async () => {
    const env = makeEnv({ '/a.zip': { 'x.jpg': 40 } });
    const cache = createArchiveCache(env);
    await cache.getArchiveEntryBytes('/a.zip', 'x.jpg');
    env.setMtime('/a.zip', 2);
    await cache.getArchiveEntryBytes('/a.zip', 'x.jpg'); // new version, new bytes key
    // Old-version bytes remain under their own key; both are small and under budget.
    assert.strictEqual(cache._bytesTotal(), 80);
  });
});
