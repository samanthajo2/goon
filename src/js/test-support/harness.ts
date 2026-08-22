/*
Copyright 2026 SamanthaJo

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

// In-process integration harness. It wires the *real* thumber (ThumbnailManager +
// real NativeFolder/VirtualFolder/ArchiveFolder) to the *real* view folder pipeline
// (FolderDB → FolderFilter → FolderStateHelper), connected by a loopback stream in
// place of Electron IPC, over an in-memory (memfs) filesystem. Filesystem mutations
// the thumber would ask the main process to perform are routed through the shared
// fs-ops module against the same memfs volume.
//
// This exercises the true cross-process message contracts (delete / create / rename /
// add-to-virtual-folder / propagation) that unit tests can't reach — without launching
// Electron.

import EventEmitter from 'node:events';
import path from 'node:path';

import ThumbnailManager from '../pages/thumber/thumbnail-manager.js';
import NativeFolder from '../pages/thumber/native-folder.js';
import ArchiveFolder from '../pages/thumber/archive-folder.js';
import VirtualFolder from '../pages/thumber/virtual-folder.js';
import createLimitedResourceManager from '../lib/limited-resource-manager.js';
import { registerThumberStreamHandlers } from '../pages/thumber/thumber-stream-handlers.js';
import * as fsOps from '../main/fs-ops.js';

import FolderDB, { DBFoldersByPath } from '../pages/view/folder-db.js';
import FolderFilter from '../pages/view/folder-filter.js';
import { FolderStateHelper, FolderStateRoot, FolderStateFolder, SortMode } from '../pages/view/folder-state-helper.js';

import { makeChannelPair } from './loopback-channel.js';
import { createMemFs, MemFs } from './mem-fs.js';
import { FilesByPath, FileInfo } from '../lib/fileinfo.js';

// A nested description of a directory tree. A string/Buffer value is a file's
// contents; an object is a subdirectory; null is an empty directory.
export type FsTree = { [name: string]: FsTree | string | Buffer | null };

export type HarnessOptions = {
  tree?: FsTree;          // initial filesystem contents
  folders: string[];      // watched root folders (like prefs "volumes")
  showEmpty?: boolean;
  sortMode?: SortMode;
};

function seedVolume(fs: MemFs, tree: FsTree, base = ''): void {
  for (const [name, val] of Object.entries(tree)) {
    const p = name.startsWith('/') ? name : path.posix.join(base, name);
    if (val === null || (typeof val === 'object' && !Buffer.isBuffer(val))) {
      fs.mkdirSync(p, { recursive: true });
      if (val) seedVolume(fs, val as FsTree, p);
    } else {
      fs.mkdirSync(path.posix.dirname(p), { recursive: true });
      fs.writeFileSync(p, val as string | Buffer);
    }
  }
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export type Harness = ReturnType<typeof makeHarness>;

export function makeHarness(options: HarnessOptions) {
  const localFS = createMemFs();
  // The thumber persists caches/indexes here (the ThumbnailManager dataDir below).
  localFS.mkdirSync('/data', { recursive: true });
  if (options.tree) seedVolume(localFS, options.tree);

  // A no-op native watcher: its mere presence lets SimpleFolderWatcher run its
  // readdir scan (a null factory would skip it). We drive changes via refreshFolder.
  const watcherFactory = (folderName: string) => {
    const w = new EventEmitter() as EventEmitter & { folderName: string; close: () => void };
    w.folderName = folderName;
    w.close = () => {};
    return w;
  };

  // Stub thumbnail-page maker: returns a FileInfo (with a fake thumbnail) per file so
  // scanned media surfaces, without real image decoding. It also writes the page PNG
  // to the volume (as the real maker does), so cleanup paths that unlink pages work.
  const stubPageMaker = async (baseFilename: string, _old: FilesByPath, newFiles: FilesByPath): Promise<FilesByPath> => {
    const out: FilesByPath = {};
    const pageUrl = `${baseFilename}_0.png`;
    if (Object.keys(newFiles).length) localFS.writeFileSync(pageUrl, '');
    for (const [k, info] of Object.entries(newFiles)) {
      out[k] = {
        ...info,
        width: 100,
        height: 100,
        thumbnail: { x: 0, y: 0, width: 100, height: 100, url: pageUrl, pageSize: 2048 },
      } as FileInfo;
    }
    return out;
  };
  const tpmManager = createLimitedResourceManager([stubPageMaker]);

  const { view, thumber } = makeChannelPair();

  // ── Thumber side ──
  const tm = new ThumbnailManager({
    dataDir: '/data',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fs: localFS as any,
    watcherFactory,
    nativeFolderFactory: (filepath, o) => new NativeFolder(filepath, o),
    archiveFolderFactory: (filepath, o) => new ArchiveFolder(filepath, o),
    virtualFolderFactory: (id, o) => new VirtualFolder(id, o),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    thumbnailPageMakerManager: tpmManager as any,
  });
  tm.loadVirtualFolders();
  tm.on('updateFiles', (folders: unknown) => thumber.send('updateFiles', folders));

  const currentFolders = [...options.folders];
  const ipcInvoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fs = localFS as any;
    switch (channel) {
      case 'createFolder': return fsOps.createFolder(fs, args[0] as string);
      case 'deleteFolder': return fsOps.deleteFolder(fs, args[0] as string);
      case 'deleteFile': return fsOps.deleteFile(fs, args[0] as string);
      case 'renameFolder': return fsOps.renameFolder(fs, args[0] as string, args[1] as string);
      case 'moveFileToDir': return fsOps.moveFileToDir(fs, args[0] as string, args[1] as string);
      case 'copyFileToDir': return fsOps.copyFileToDir(fs, args[0] as string, args[1] as string);
      default: throw new Error(`harness: unhandled ipcInvoke '${channel}'`);
    }
  };
  const virtualFolderState = () => ({ list: tm.listVirtualFolders(), recent: tm.getRecentVirtualFolders() });
  const sendVirtualFolders = () => thumber.send('virtualFolders', virtualFolderState());

  registerThumberStreamHandlers(thumber, {
    thumbnailManager: tm,
    ipcInvoke,
    sendVirtualFolders,
    virtualFolderState,
    refreshFolders: () => currentFolders.forEach(f => tm.refreshFolder(f)),
    statIsDirectory: (p: string) => { try { return localFS.statSync(p).isDirectory(); } catch { return false; } },
    log: () => {},
  });

  // ── View side pipeline (mirrors use-folder-pipeline) ──
  const root: FolderStateRoot = FolderStateHelper.createRoot(options.sortMode ?? 'sortPath');
  const folderDB = new FolderDB(5); // small throttle so the pipeline settles fast in tests
  const folderFilter = new FolderFilter();
  let filterQueued = false;
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  const processFilter = () => { filterQueued = false; if (folderFilter.process()) queueFilter(); };
  const queueFilter = () => { if (!filterQueued) { filterQueued = true; process.nextTick(processFilter); } };
  folderDB.on('updateFiles', (folders: DBFoldersByPath) => folderFilter.updateFiles(folders));
  folderFilter.on('updateFiles', (folders: DBFoldersByPath) =>
    FolderStateHelper.updateFolders(root, folders as never, { showEmpty: !!options.showEmpty }));
  folderFilter.on('pending', queueFilter);
  folderFilter.setFilter(() => true);

  let virtualFolders: { list: unknown[]; recent: unknown[] } = { list: [], recent: [] };
  view.on('updateFiles', (folders: DBFoldersByPath) => folderDB.updateFiles(folders));
  view.on('virtualFolders', (vf: { list: unknown[]; recent: unknown[] }) => { virtualFolders = vf; });

  // Kick off: register folders, then pull the initial snapshot (like the view does).
  tm.setFolders(currentFolders);
  view.send('requestAll');

  const folderNames = (): string[] => root.folders.map(f => f.filename);
  const folder = (key: string): FolderStateFolder | undefined => root.folders.find(f => f.filename === key);

  async function waitFor(predicate: () => boolean, opts: { timeout?: number; interval?: number } = {}): Promise<void> {
    const timeout = opts.timeout ?? 3000;
    const interval = opts.interval ?? 10;
    const start = Date.now();
    for (;;) {
      if (predicate()) return;
      if (Date.now() - start > timeout) {
        throw new Error(`harness.waitFor timed out; folders = ${JSON.stringify(folderNames())}`);
      }
      await delay(interval);
    }
  }

  return {
    root,
    vol: localFS, // the in-memory filesystem, for seeding/assertions
    thumbnailManager: tm,
    folderNames,
    folder,
    virtualFolders: () => virtualFolders,
    // Dispatch a message from the view to the thumber (e.g. 'createFolder', key).
    send: (event: string, ...args: unknown[]) => view.send(event, ...args),
    waitFor,
    settle: (ms = 60) => delay(ms),
    close: () => { view.close(); thumber.close(); },
  };
}
