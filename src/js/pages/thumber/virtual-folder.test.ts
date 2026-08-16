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

function makeVF(id: string) {
  const jsonFs = makeJsonFs();
  const mediaFs = makeMediaFs();
  const { fn, calls } = makeThumbFn();
  const def = new VirtualFolderData(id, { fs: jsonFs, dataDir });
  const cache = new FolderData(id, { fs: jsonFs, dataDir, prefix: 'vfolder-cache' });
  const vf = new VirtualFolder(id, { def, cache, thumbnailPageMakerFn: fn, fs: mediaFs });
  return { vf, def, cache, mediaFs, jsonFs, calls };
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
