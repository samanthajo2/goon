/*
Copyright 2024 SamanthaJo

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

// Cross-folder behavior: a real file /vol/c.jpg is referenced by BOTH a NativeFolder
// (its real folder) and a VirtualFolder. Verifies that when the file changes, is
// deleted, or is missing-while-the-volume-is-visible, BOTH folders react — driven by
// the same propagation the ThumbnailManager wires (NativeFolder emits `filesChanged`;
// referencing virtual folders refresh / remove). Uses real NativeFolder + real
// VirtualFolder over a shared in-memory "disk" so no real rendering is needed.

import EventEmitter from 'node:events';
import { assert } from 'chai';
import NativeFolder from './native-folder.js';
import VirtualFolder from './virtual-folder.js';
import VirtualFolderData, { VirtualFolderFsAPI } from './virtual-folder-data.js';
import FolderData from './folder-data.js';
import { FileInfo, FilesByPath } from '../../lib/fileinfo.js';
import wait from '../../lib/wait.js';

const C = '/vol/c.jpg';
const DIR = '/vol';
const dataDir = '/data';

// Shared "disk": which real files exist (with size/mtime) and which dirs exist.
function makeDisk() {
  const files = new Map<string, { size: number; mtime: number }>();
  const dirs = new Set<string>();
  return { files, dirs };
}

// Produce a full FileInfo from a (possibly stat-only) entry — stands in for the real
// thumbnail page maker. Records calls so we can see what got regenerated.
function makePageMaker() {
  const calls: { new: string[]; base: string }[] = [];
  const fn = async (_old: FilesByPath, nw: FilesByPath, base: string): Promise<FilesByPath> => {
    calls.push({ new: Object.keys(nw), base });
    const out: FilesByPath = {};
    for (const [p, info] of Object.entries(nw)) {
      out[p] = {
        displayName: p, isDirectory: false, mtime: info.mtime, size: info.size,
        orientation: 1, type: info.type || 'image/jpeg', width: 100, height: 100,
        thumbnail: { x: 0, y: 0, width: 100, height: 100, url: `${base}_0.png`, pageSize: 2048 },
      } as FileInfo;
    }
    return out;
  };
  return { fn, calls };
}

// Minimal FolderData-like cache for the NativeFolder (same shape native-folder.test uses).
function makeNativeFolderData() {
  return {
    files: {} as FilesByPath,
    baseFilename: 'native-base',
    deleteData() { return { imagesAndVideos: [], folders: [], archives: [] }; },
    addFiles(files: FilesByPath) { Object.assign(this.files, files); },
    removeFiles(names: string[]) { for (const n of names) delete this.files[n]; },
    setScannedTime() {},
  };
}

// Includes readdir (unused here) so it also satisfies FolderData's fs type.
function makeJsonFs(): VirtualFolderFsAPI & { readdir: (p: string, cb: (e: Error | null, f: string[]) => void) => void } {
  const store = new Map<string, string>();
  return {
    existsSync: (p) => store.has(p),
    readFileAsStringSync: (p) => { const v = store.get(p); if (v === undefined) throw new Error('ENOENT'); return v; },
    writeFileSync: (p, d) => { store.set(p, String(d)); },
    unlinkSync: (p) => { store.delete(p); },
    readdir: (_p, cb) => cb(null, []),
  };
}

describe('VirtualFolder ↔ NativeFolder (shared real file)', () => {
  // Builds a NativeFolder for /vol (driven by a fake watcher), a VirtualFolder that
  // references /vol/c.jpg, and wires them the way ThumbnailManager does.
  function setup(disk: ReturnType<typeof makeDisk>) {
    // NativeFolder with a fake watcher (emit 'files' to simulate a readdir result).
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = () => {};
    const nativeData = makeNativeFolderData();
    const nativePM = makePageMaker();
    const nativeFolder = new NativeFolder(DIR, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      watcher: watcher as any,
      thumbnailPageMakerFn: nativePM.fn,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      folderData: nativeData as any,
      fs: { unlinkSync: () => {} },
    });

    // VirtualFolder referencing C.
    const jsonFs = makeJsonFs();
    const def = new VirtualFolderData('vf1', { fs: jsonFs, dataDir });
    const cache = new FolderData('vf1', { fs: jsonFs, dataDir, prefix: 'vfolder-cache' });
    const vfPM = makePageMaker();
    const mediaFs = {
      statSync: (p: string) => {
        const f = disk.files.get(p);
        if (!f) throw new Error(`ENOENT: ${p}`);
        return { size: f.size, mtimeMs: f.mtime, isDirectory: () => false };
      },
      existsSync: (p: string) => disk.dirs.has(p) || disk.files.has(p),
      unlinkSync: () => {},
    };
    const archivePM = async () => ({});
    const vf = new VirtualFolder('vf1', {
      def, cache, thumbnailPageMakerFn: vfPM.fn, archiveThumbnailPageMakerFn: archivePM, fs: mediaFs,
    });

    // Wire propagation exactly like ThumbnailManager._propagateToVirtualFolders.
    const pendingRefreshes: Promise<void>[] = [];
    nativeFolder.on('filesChanged', ({ changed, removed }) => {
      for (const p of removed) {
        if (vf.references(p)) vf.removeFileAndNotify(p);
      }
      const toRefresh = new Set<VirtualFolder>();
      for (const p of changed) {
        if (vf.references(p)) toRefresh.add(vf);
      }
      for (const v of toRefresh) pendingRefreshes.push(v.refresh());
    });

    // Simulate a watcher readdir result from the current disk state for /vol.
    async function driveWatcher() {
      const listing: FilesByPath = {};
      for (const [p, f] of disk.files) {
        if (p.startsWith(DIR + '/')) {
          listing[p] = { size: f.size, mtime: f.mtime, isDirectory: false } as unknown as FileInfo;
        }
      }
      watcher.emit('files', listing);
      await Promise.all(pendingRefreshes.splice(0));
      await wait(); await wait(); await wait();
      await Promise.all(pendingRefreshes.splice(0));
      await wait();
    }

    return { nativeFolder, nativeData, nativePM, vf, def, cache, vfPM, driveWatcher };
  }

  it('change: both the NativeFolder and the VirtualFolder update c\'s thumbnail', async () => {
    const disk = makeDisk();
    disk.dirs.add(DIR);
    disk.files.set(C, { size: 1, mtime: 10 });
    const s = setup(disk);
    await wait();

    s.def.addFiles([C]);
    await s.vf.refresh();
    await s.driveWatcher();
    assert.strictEqual(s.nativeData.files[C].mtime, 10, 'native has c@10');
    assert.strictEqual(s.vf.getData().files[C].mtime, 10, 'virtual has c@10');
    const nativeCallsBefore = s.nativePM.calls.length;
    const vfCallsBefore = s.vfPM.calls.length;

    // c changes on disk.
    disk.files.set(C, { size: 1, mtime: 99 });
    await s.driveWatcher();

    assert.strictEqual(s.nativeData.files[C].mtime, 99, 'native updated c to @99');
    assert.strictEqual(s.vf.getData().files[C].mtime, 99, 'virtual updated c to @99');
    assert.isAbove(s.nativePM.calls.length, nativeCallsBefore, 'native regenerated');
    assert.isAbove(s.vfPM.calls.length, vfCallsBefore, 'virtual regenerated');
    assert.include(s.vfPM.calls[s.vfPM.calls.length - 1].new, C);
  });

  it('delete (volume visible): both remove c', async () => {
    const disk = makeDisk();
    disk.dirs.add(DIR);
    disk.files.set(C, { size: 1, mtime: 10 });
    const s = setup(disk);
    await wait();
    s.def.addFiles([C]);
    await s.vf.refresh();
    await s.driveWatcher();
    assert.ok(s.vf.getData().files[C], 'virtual has c initially');

    // c is deleted; its directory (volume) is still present.
    disk.files.delete(C);
    await s.driveWatcher();

    assert.isUndefined(s.nativeData.files[C], 'native removed c');
    assert.isUndefined(s.vf.getData().files[C], 'virtual removed c');
    assert.notInclude(s.def.files, C, 'virtual dropped c from its membership');
  });

  it('offline (volume not visible): neither removes c', async () => {
    const disk = makeDisk();
    disk.dirs.add(DIR);
    disk.files.set(C, { size: 1, mtime: 10 });
    const s = setup(disk);
    await wait();
    s.def.addFiles([C]);
    await s.vf.refresh();
    await s.driveWatcher();
    assert.ok(s.vf.getData().files[C], 'virtual has c initially');

    // Volume goes offline: the file AND its directory disappear. A real watcher
    // suppresses removals on a failed readdir, so we do NOT drive a removal.
    disk.files.delete(C);
    disk.dirs.delete(DIR);
    // The user opens/refreshes the virtual folder while offline.
    await s.vf.refresh();

    assert.ok(s.nativeData.files[C], 'native keeps c (watcher suppressed the removal)');
    assert.ok(s.vf.getData().files[C], 'virtual keeps c (offline, not confirmed gone)');
    assert.include(s.def.files, C, 'virtual keeps c in its membership');
  });
});
