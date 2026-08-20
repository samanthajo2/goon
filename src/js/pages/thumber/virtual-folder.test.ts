import { assert } from 'chai';
import VirtualFolder from './virtual-folder.js';
import VirtualFolderData, { VirtualFolderFsAPI } from './virtual-folder-data.js';
import FolderData from './folder-data.js';
import { FileInfo, FilesByPath } from '../../lib/fileinfo.js';

const dataDir = '/data';
const tick = () => new Promise<void>(r => setImmediate(r));

// JSON persistence fs (for VirtualFolderData + FolderData).
function makeJsonFs(): VirtualFolderFsAPI & { readdir: never } {
  const store = new Map<string, string>();
  return {
    existsSync: (p: string) => store.has(p),
    readFileAsStringSync: (p: string) => {
      const v = store.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeFileSync: (p: string, data: string | Buffer) => { store.set(p, String(data)); },
    unlinkSync: (p: string) => { store.delete(p); },
  } as VirtualFolderFsAPI & { readdir: never };
}

// Media fs: controls which real files/dirs exist for statSync/existsSync, and records
// thumbnail-page unlinks.
function makeMediaFs() {
  const files = new Map<string, { size: number; mtime: number }>();
  const dirs = new Set<string>();
  const unlinked: string[] = [];
  return {
    files, dirs, unlinked,
    statSync: (p: string) => {
      const f = files.get(p);
      if (!f) throw new Error(`ENOENT: ${p}`);
      return { size: f.size, mtimeMs: f.mtime, isDirectory: () => false };
    },
    existsSync: (p: string) => dirs.has(p) || files.has(p),
    unlinkSync: (p: string) => { unlinked.push(p); },
  };
}

// Fake page maker: returns a full FileInfo for every key in newMedia, records calls.
function makeThumbFn() {
  const calls: { old: string[]; new: string[]; base: string }[] = [];
  const fn = async (oldMedia: FilesByPath, newMedia: FilesByPath, base: string): Promise<FilesByPath> => {
    calls.push({ old: Object.keys(oldMedia), new: Object.keys(newMedia), base });
    const out: FilesByPath = {};
    for (const [p, info] of Object.entries(newMedia)) {
      out[p] = {
        displayName: p,
        isDirectory: false,
        mtime: info.mtime,
        size: info.size,
        orientation: 1,
        type: info.type || 'image/jpeg',
        width: 100,
        height: 100,
        thumbnail: { x: 0, y: 0, width: 100, height: 100, url: `${base}_0.png`, pageSize: 2048 },
      } as FileInfo;
    }
    return out;
  };
  return { fn, calls };
}

// Fake archive maker: returns a FileInfo for each requested entry, keyed by the
// composite path (archive + entry), tagged with archiveName. Records calls.
function makeArchiveThumbFn() {
  const calls: { archiveName: string; base: string; entryNames: string[] }[] = [];
  const fn = async (archiveName: string, base: string, entryNames: string[]): Promise<FilesByPath> => {
    calls.push({ archiveName, base, entryNames });
    const out: FilesByPath = {};
    for (const entryName of entryNames) {
      const p = `${archiveName}/${entryName}`;
      out[p] = {
        displayName: p,
        archiveName,
        isDirectory: false,
        mtime: 1,
        size: 10,
        orientation: 1,
        type: 'image/jpeg',
        width: 100,
        height: 100,
        thumbnail: { x: 0, y: 0, width: 100, height: 100, url: `${base}_0.png`, pageSize: 2048 },
      } as FileInfo;
    }
    return out;
  };
  return { fn, calls };
}

function makeVF(id: string) {
  const jsonFs = makeJsonFs();
  const mediaFs = makeMediaFs();
  const { fn, calls } = makeThumbFn();
  const { fn: archiveFn, calls: archiveCalls } = makeArchiveThumbFn();
  const def = new VirtualFolderData(id, { fs: jsonFs, dataDir });
  const cache = new FolderData(id, { fs: jsonFs, dataDir, prefix: 'vfolder-cache' });
  const vf = new VirtualFolder(id, {
    def, cache, thumbnailPageMakerFn: fn, archiveThumbnailPageMakerFn: archiveFn, fs: mediaFs,
  });
  return { vf, def, cache, mediaFs, jsonFs, calls, archiveCalls };
}

describe('VirtualFolder', () => {
  it('has a synthetic vfolder: key and virtual status', async () => {
    const { vf } = makeVF('id1');
    await tick();
    assert.strictEqual(vf.filename, 'vfolder:id1');
    assert.isTrue(vf.getData().status.virtual);
  });

  it('generates thumbnails for present media', async () => {
    const { vf, def, mediaFs, calls } = makeVF('id1');
    await tick(); // let the constructor's initial (empty) refresh settle
    mediaFs.dirs.add('/vol');
    mediaFs.files.set('/vol/a.jpg', { size: 1, mtime: 10 });
    mediaFs.files.set('/vol/b.jpg', { size: 2, mtime: 20 });
    def.addFiles(['/vol/a.jpg', '/vol/b.jpg']);
    await vf.refresh();
    assert.sameMembers(Object.keys(vf.getData().files), ['/vol/a.jpg', '/vol/b.jpg']);
    assert.sameMembers(calls[calls.length - 1].new, ['/vol/a.jpg', '/vol/b.jpg']);
  });

  it('keeps a file whose volume is offline, but prunes one confirmed gone', async () => {
    const { vf, def, mediaFs, calls } = makeVF('id1');
    await tick();
    // a on /volA, b on /volB; both present initially.
    mediaFs.dirs.add('/volA');
    mediaFs.dirs.add('/volB');
    mediaFs.files.set('/volA/a.jpg', { size: 1, mtime: 10 });
    mediaFs.files.set('/volB/b.jpg', { size: 2, mtime: 20 });
    def.addFiles(['/volA/a.jpg', '/volB/b.jpg']);
    await vf.refresh();
    assert.sameMembers(Object.keys(vf.getData().files), ['/volA/a.jpg', '/volB/b.jpg']);
    const callsAfterInitial = calls.length;

    // b's volume goes offline: file and its dir both disappear.
    mediaFs.files.delete('/volB/b.jpg');
    mediaFs.dirs.delete('/volB');
    await vf.refresh();
    assert.sameMembers(Object.keys(vf.getData().files), ['/volA/a.jpg', '/volB/b.jpg'],
      'offline file is kept');
    assert.include(def.files, '/volB/b.jpg', 'offline file stays in the definition');
    assert.strictEqual(calls.length, callsAfterInitial, 'no regeneration when nothing changed');

    // a is truly deleted: file gone but its dir (volume) still present.
    mediaFs.files.delete('/volA/a.jpg');
    await vf.refresh();
    assert.notInclude(Object.keys(vf.getData().files), '/volA/a.jpg', 'gone file is pruned');
    assert.notInclude(def.files, '/volA/a.jpg', 'gone file removed from the definition');
    assert.sameMembers(Object.keys(vf.getData().files), ['/volB/b.jpg']);
  });

  it('regenerates only when a file actually changes', async () => {
    const { vf, def, mediaFs, calls } = makeVF('id1');
    await tick();
    mediaFs.dirs.add('/vol');
    mediaFs.files.set('/vol/a.jpg', { size: 1, mtime: 10 });
    def.addFiles(['/vol/a.jpg']);
    await vf.refresh();
    const afterFirst = calls.length;

    // No change → no regeneration.
    await vf.refresh();
    assert.strictEqual(calls.length, afterFirst, 'unchanged → no regen');

    // Change mtime → regenerate just that file.
    mediaFs.files.set('/vol/a.jpg', { size: 1, mtime: 99 });
    await vf.refresh();
    assert.strictEqual(calls.length, afterFirst + 1, 'changed → regen');
    assert.deepEqual(calls[calls.length - 1].new, ['/vol/a.jpg']);
  });

  it('removeFiles removes from the folder only (not disk) and updates thumbnails', async () => {
    const { vf, def, mediaFs } = makeVF('id1');
    await tick();
    mediaFs.dirs.add('/vol');
    mediaFs.files.set('/vol/a.jpg', { size: 1, mtime: 10 });
    mediaFs.files.set('/vol/b.jpg', { size: 2, mtime: 20 });
    def.addFiles(['/vol/a.jpg', '/vol/b.jpg']);
    await vf.refresh();

    vf.removeFiles(['/vol/a.jpg']);
    await tick(); // removeFiles kicks off refresh() asynchronously
    assert.notInclude(def.files, '/vol/a.jpg', 'removed from definition');
    assert.include(def.files, '/vol/b.jpg');
    assert.isTrue(mediaFs.files.has('/vol/a.jpg'), 'the real file on disk is untouched');
    assert.sameMembers(Object.keys(vf.getData().files), ['/vol/b.jpg']);
  });

  it('generates thumbnails for archive entries via the archive maker', async () => {
    const { vf, def, mediaFs, archiveCalls } = makeVF('id1');
    await tick();
    mediaFs.dirs.add('/vol');
    mediaFs.files.set('/vol/pics.zip', { size: 100, mtime: 5 });
    def.addArchiveFiles([
      { archiveName: '/vol/pics.zip', entryName: 'a.jpg' },
      { archiveName: '/vol/pics.zip', entryName: 'b.jpg' },
    ]);
    await vf.refresh();
    assert.sameMembers(Object.keys(vf.getData().files), ['/vol/pics.zip/a.jpg', '/vol/pics.zip/b.jpg']);
    assert.strictEqual(archiveCalls.length, 1, 'archive decompressed once');
    assert.strictEqual(archiveCalls[0].archiveName, '/vol/pics.zip');
    assert.sameMembers(archiveCalls[0].entryNames, ['a.jpg', 'b.jpg'], 'only referenced entries requested');

    // Viewability contract: the media-manager archive branch keys off these three
    // fields. The key must be the composite path (what requestMedia sends), and the
    // FileInfo must carry the real archive path + a media mime type so the server can
    // path.dirname/path.basename it, open the archive, and the viewer can render it.
    const entry = vf.getData().files['/vol/pics.zip/a.jpg'];
    assert.strictEqual(entry.archiveName, '/vol/pics.zip', 'archiveName = real on-disk archive');
    assert.match(entry.type, /^image\//, 'media mime type present');
  });

  it('does not re-decompress an unchanged archive, but regenerates a changed one', async () => {
    const { vf, def, mediaFs, archiveCalls } = makeVF('id1');
    await tick();
    mediaFs.dirs.add('/vol');
    mediaFs.files.set('/vol/pics.zip', { size: 100, mtime: 5 });
    def.addArchiveFiles([{ archiveName: '/vol/pics.zip', entryName: 'a.jpg' }]);
    await vf.refresh();
    assert.strictEqual(archiveCalls.length, 1);

    // Unchanged archive → no re-decompress.
    await vf.refresh();
    assert.strictEqual(archiveCalls.length, 1, 'archive mtime unchanged → skipped');

    // Archive file changes → regenerate its entries.
    mediaFs.files.set('/vol/pics.zip', { size: 120, mtime: 9 });
    await vf.refresh();
    assert.strictEqual(archiveCalls.length, 2, 'changed archive → regen');
    assert.deepEqual(archiveCalls[1].entryNames, ['a.jpg']);
  });

  it('keeps archive entries when the archive is offline, prunes them when it is gone', async () => {
    const { vf, def, mediaFs, archiveCalls } = makeVF('id1');
    await tick();
    mediaFs.dirs.add('/vol');
    mediaFs.files.set('/vol/pics.zip', { size: 100, mtime: 5 });
    def.addArchiveFiles([{ archiveName: '/vol/pics.zip', entryName: 'a.jpg' }]);
    await vf.refresh();
    const afterFirst = archiveCalls.length;

    // Volume offline: archive file and its dir both disappear → keep cached entry.
    mediaFs.files.delete('/vol/pics.zip');
    mediaFs.dirs.delete('/vol');
    await vf.refresh();
    assert.include(Object.keys(vf.getData().files), '/vol/pics.zip/a.jpg', 'offline archive entry kept');
    assert.deepEqual(def.archives, [{ archiveName: '/vol/pics.zip', entryName: 'a.jpg' }], 'still referenced');
    assert.strictEqual(archiveCalls.length, afterFirst, 'no regen while offline');

    // Archive truly deleted: file gone but its dir (volume) present → prune.
    mediaFs.dirs.add('/vol');
    await vf.refresh();
    assert.notInclude(Object.keys(vf.getData().files), '/vol/pics.zip/a.jpg', 'gone archive entry pruned');
    assert.deepEqual(def.archives, [], 'removed from the definition');
  });

  it('referencesArchive reports whether any entry lives in the given archive', async () => {
    const { vf, def } = makeVF('id1');
    await tick();
    def.addArchiveFiles([{ archiveName: '/vol/pics.zip', entryName: 'a.jpg' }]);
    assert.isTrue(vf.referencesArchive('/vol/pics.zip'));
    assert.isFalse(vf.referencesArchive('/vol/other.zip'));
    assert.isTrue(vf.references('/vol/pics.zip/a.jpg'), 'references matches composite path');
  });

  it('deleteData removes the thumbnail pages and the definition, not the real files', async () => {
    const { vf, def, cache, mediaFs, jsonFs } = makeVF('id1');
    await tick();
    mediaFs.dirs.add('/vol');
    mediaFs.files.set('/vol/a.jpg', { size: 1, mtime: 10 });
    def.addFiles(['/vol/a.jpg']);
    def.flush();
    await vf.refresh();

    vf.deleteData();
    assert.include(mediaFs.unlinked, `${cache.baseFilename}_0.png`, 'thumbnail page unlinked');
    assert.isTrue(mediaFs.files.has('/vol/a.jpg'), 'real file untouched');
    // definition JSON removed
    assert.isFalse(jsonFs.existsSync(`${def.baseFilename}.json`));
  });
});
