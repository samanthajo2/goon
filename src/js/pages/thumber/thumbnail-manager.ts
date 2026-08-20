/*
Copyright 2024 SamanthaJo

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

// Architecture
//
// * ThumbnailManager watches a tree of folders
//   and loads/generates thumbnails
//
//   For each folder it creates a `Folder`.
//
//   Viewers should subscribe to a folder
//   with `getFolder` or maybe it should emit
//   'newFolder`
//
// * Folder
//
//   Represents the thumbnails of an individual
//   Folder/Archive.
//
//   When one is added to a view something should
//   call emitFiles which tells the Folder to
//   send out events for all the files it had
//
//   Otherwise the emits `addFile`, `removeFile`
//   events for each thumbnail
//

// * ThumbnailCollection
//
//   * Manages a set of images with thumbnails in them
//   * Loads from JSON
//   * Accepts events for new files
//     * If any file is new generates new thumbnails (if not already generating)
//     * saves to JSON on exit?
//       Why save on exit? Because files can be added at anytime. Maybe also save
//       on timeout since could crash?
//       This seems problematic. Maybe I shouldn't be *watching* folder at this level?
//       Except I like the idea of being able to add/delete individual files so do this
//

// ThumbnailCollection
//   Loads exis
//   Waits for add/change/remove events
//
//


import EventEmitter from 'node:events';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { throttle, arrayDifference } from '../../lib/utils.js';
import { makeVirtualFolderKey } from './virtual-folder-key.js';
import bind from '../../lib/bind.js';
import debug from '../../lib/debug.js';
import NativeFolder from './native-folder.js';
import ArchiveFolder from './archive-folder.js';
import VirtualFolder from './virtual-folder.js';
import VirtualFolderData from './virtual-folder-data.js';
import VirtualFolderIndex, { VirtualFolderEntry } from './virtual-folder-index.js';
import type { BaseFolder } from './base-folder.js';
import createThumbnailsForFolder, { ThumbnailPageMakerFn } from './folder-thumbnail-maker.js';
import createThumbnailsForArchive from './archive-thumbnail-maker.js';
import WatcherConsolidator from './watcher-consolidator.js';
import FolderData from './folder-data.js';
import { FilesByPath } from '../../lib/fileinfo.js';
import { LimitedResourceManager } from '../../lib/limited-resource-manager.js';
import { MakeThumbnailPagesFn } from './thumbnail-page-maker-def.js';
import { FolderWatcherInterface } from '../../lib/watcher/folder-watcher.js';

function arrayInANotB<T>(a: T[], b: T[]) {
  return a.filter((elem) => b.indexOf(elem) < 0);
}

// This runs on the "server" and watches the filesystem
// for changes. It uses a Thumbnailer to generate
// thumbnails

type NativeFolderInst = InstanceType<typeof NativeFolder>;
type ArchiveFolderInst = InstanceType<typeof ArchiveFolder>;
type VirtualFolderInst = InstanceType<typeof VirtualFolder>;

// A member to add to a virtual folder: a plain file (archiveName omitted) or an
// archive entry, whose `path` is the composite path.join(archiveName, entryName).
export type VirtualFolderAddEntry = { path: string; archiveName?: string };

type FolderInfo = {
  folder: BaseFolder;
  folders: Record<string, FolderInfo>;
  archives: Record<string, FolderInfo>;
};

type RootFolderInfo = {
  folder?: BaseFolder;
  folders: Record<string, FolderInfo>;
  archives: Record<string, FolderInfo>;
};

type StreamLike = { send: (eventName: string, data: unknown) => void };

// Filesystem API required by the Thumber modules. Methods are optional because
// different modules require different subsets.
// Filesystem API required by thumber modules. Methods listed here are expected
// to exist on the `fs` object passed into ThumbnailManager.
type FsApi = {
  existsSync: (path: string) => boolean;
  readdir: (path: string, callback: (err: Error | null, files: string[]) => void) => void;
  readFileAsStringSync: (path: string) => string;
  unlinkSync: (path: string) => void;
  writeFileSync: (path: string, data: string | Buffer) => void;
  statSync: (path: string) => { size: number; mtimeMs: number; isDirectory: () => boolean };
  stat: (path: string, callback: (err: Error | null, stats: { size: number; mtimeMs: number; isDirectory: () => boolean }) => void) => void;
};

type SentFolder = {
  files: FilesByPath;
  status?: {
    scanning?: boolean;
    checking?: boolean;
    scannedTime?: number;
    archive?: boolean;
    virtual?: boolean;
    name?: string;
  };
  [k: string]: unknown;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Factory<T extends new (...args: any) => any> = 
    (...args: ConstructorParameters<T>) => InstanceType<T>;

export default class ThumbnailManager extends EventEmitter {
  #dataDir: string;
  #fs: FsApi;
  #watcherFactory: (filePath: string) => FolderWatcherInterface | null;
  #rootFolderNames: string[] = [];
  #baseFolderNames: string[] = [];
  #updateFilesPendingFolders: Record<string, SentFolder> = {};
  #logger: ReturnType<typeof debug>;
  #folderThumbnailPageMakerFn: ThumbnailPageMakerFn;
  #archiveThumbnailPageMakerFn: (filepath: string, baseFilename: string, entryNames?: string[]) => Promise<FilesByPath>;
  #nativeFolderFactory: Factory<typeof NativeFolder>;
  #archiveFolderFactory: Factory<typeof ArchiveFolder>;
  #virtualFolderFactory: Factory<typeof VirtualFolder>;
  #virtualFolderIndex: VirtualFolderIndex;

  // not private for testing. Should fix.
  _folders: Record<string, FolderInfo> = {};
  _archives: Record<string, FolderInfo> = {};
  // Virtual folders keyed by id (their view key is `vfolder:<id>`). They are a flat,
  // top-level set — not part of the _rootFolder tree.
  _virtualFolders: Record<string, VirtualFolderInst> = {};
  _rootFolder: RootFolderInfo = { folders: {}, archives: {} };

  constructor(options: {
    dataDir: string;
    fs: FsApi;
    watcherFactory: (filePath: string) => FolderWatcherInterface | null;
    nativeFolderFactory: Factory<typeof NativeFolder>;
    archiveFolderFactory: Factory<typeof ArchiveFolder>;
    virtualFolderFactory: Factory<typeof VirtualFolder>;
    thumbnailPageMakerManager: LimitedResourceManager<MakeThumbnailPagesFn>;
  }) {
    super();
    this.#dataDir = options.dataDir;
    this.#fs = options.fs;
    this.#watcherFactory = options.watcherFactory;
    this.#nativeFolderFactory = options.nativeFolderFactory;
    this.#archiveFolderFactory = options.archiveFolderFactory;
    this.#virtualFolderFactory = options.virtualFolderFactory;
    this.#virtualFolderIndex = new VirtualFolderIndex({ fs: this.#fs, dataDir: this.#dataDir });
    this._folders = {};
    this._archives = {};
    this.#rootFolderNames = [];
    this.#baseFolderNames = [];
    this.#updateFilesPendingFolders = {};
    // this smells :(
    this._rootFolder = { folders: {}, archives: {} };
    const thumbnailPageMakerManager = options.thumbnailPageMakerManager;
    bind(
      this,
      '_addFolder',
      '_removeFolder',
      '_addArchive',
      '_removeArchive',
      '_updateFolders',
      '_updateFiles',
      '_updateArchives',
      '_emitUpdateFiles',
      '_propagateToVirtualFolders',
      'refreshFolder',
    );
    this._emitUpdateFiles = throttle(this._emitUpdateFiles.bind(this), 500);
    this.#logger = debug('ThumbnailManager');
    this.#folderThumbnailPageMakerFn = (oldFiles, newFiles, baseFilename) => createThumbnailsForFolder(oldFiles, newFiles, baseFilename, thumbnailPageMakerManager);
    this.#archiveThumbnailPageMakerFn = (filepath, baseFilename, entryNames) => createThumbnailsForArchive(filepath, baseFilename, thumbnailPageMakerManager, entryNames);
  }

  setFolders(dirs: string[], deleteMetaDataOnRemovedFolders?: boolean) {
    this.#baseFolderNames = dirs.map((folderPath) => path.dirname(folderPath));
    const foldersToRemove = arrayDifference(this.#rootFolderNames, dirs);
    foldersToRemove.forEach((folder) => {
      const shouldDelete = deleteMetaDataOnRemovedFolders && this.#fs.existsSync(folder);
      this._removeFolder(folder, shouldDelete);
    });
    this.#rootFolderNames = dirs;
    dirs.forEach(this._addFolder as (s: string) => void);
  }

  sendAll(stream: StreamLike) {
    this._sendFolder(this._rootFolder, stream);
    // Virtual folders are flat/top-level, not part of the tree.
    for (const vf of Object.values(this._virtualFolders)) {
      stream.send('updateFiles', this._prepFilesForSending(vf.filename, vf.getData()));
    }
  }

  refreshFolder(folderName: string) {
    const folder = this._folders[folderName] || this._archives[folderName];
    if (folder) {
      folder.folder.refresh();
      Object.keys(folder.folders).forEach(this.refreshFolder.bind(this));
      Object.keys(folder.archives).forEach(this.refreshFolder.bind(this));
    } else {
      this.#logger('no such folder:', folderName);
    }
  }

  _sendFolder(folder: RootFolderInfo | FolderInfo, stream: StreamLike) {
    if ('folder' in folder && folder.folder) {
      const data = folder.folder.getData();
      const filename = folder.folder.filename;
      stream.send('updateFiles', this._prepFilesForSending(filename, data));
    }
    Object.keys(folder.folders).forEach((name) => {
      const subFolder = folder.folders[name];
      this._sendFolder(subFolder, stream);
    });
    Object.keys(folder.archives).forEach((name) => {
      const subFolder = folder.archives[name];
      this._sendFolder(subFolder, stream);
    });
  }

  _logFile(eventName: string, d: unknown) {
    this.#logger(eventName, JSON.stringify(d));
  }

  _addFolder(filename: string) {
    let folder = this._folders[filename];
    if (!folder) {
      const folderData = new FolderData(filename, { fs: this.#fs, dataDir: this.#dataDir });
      const cachedFiles = folderData.files;
      const initialEntries = new Map<string, { size: number; mtimeMs: number; isDirectory: boolean }>();
      for (const [filePath, fileInfo] of Object.entries(cachedFiles)) {
        initialEntries.set(path.basename(filePath), {
          size: fileInfo.size,
          mtimeMs: fileInfo.mtime,  // FileInfo.mtime is stored as stat.mtimeMs
          isDirectory: fileInfo.isDirectory,
        });
      }
      const folderOptions: {
        folderData: FolderData;
        thumbnailPageMakerFn: ThumbnailPageMakerFn;
        watcher: WatcherConsolidator;
        fs: FsApi;
      } = {
        folderData,
        thumbnailPageMakerFn: this.#folderThumbnailPageMakerFn,
        watcher: new WatcherConsolidator(filename, this.#watcherFactory, this.#fs, {
          cachedDirMtime: folderData.dirMtime,
          initialEntries,
          onDirMtime: (mtime) => folderData.setDirMtime(mtime),
        }),
        fs: this.#fs,
      };
      const nativeFolder = this.#nativeFolderFactory(filename, folderOptions);
      folder = {
        folder: nativeFolder,
        folders: {}, // this smells. Like `Folder` should handle this?
        archives: {}, // this smells. Like `Folder` should handle it?
      };
      this._folders[filename] = folder;
      const parent = this._folders[path.dirname(filename)] || this._rootFolder;
      parent.folders[filename] = folder;

      nativeFolder.on('updateFiles', this._updateFiles);
      nativeFolder.on('updateFolders', this._updateFolders);
      nativeFolder.on('updateArchives', this._updateArchives);
      nativeFolder.on('filesChanged', this._propagateToVirtualFolders);
    }
    return folder;
  }

  // A real folder reported files changed/removed on disk. Fan those out to every
  // virtual folder that references them so their own thumbnails stay in sync — the
  // hub the native watcher and virtual folders meet at. (Volume-offline removals
  // never reach here: the watcher suppresses them, so offline files stay put.)
  _propagateToVirtualFolders(changes: { changed: string[]; removed: string[] }) {
    const vfolders = Object.values(this._virtualFolders);
    if (vfolders.length === 0) {
      return;
    }
    const toRefresh = new Set<VirtualFolderInst>();
    for (const filePath of changes.removed) {
      for (const vf of vfolders) {
        if (vf.references(filePath)) {
          vf.removeFileAndNotify(filePath);
        }
        // The changed/removed path might be an archive file whose entries this
        // folder references; refresh lets it re-stat and prune/regenerate.
        if (vf.referencesArchive(filePath)) {
          toRefresh.add(vf);
        }
      }
    }
    for (const filePath of changes.changed) {
      for (const vf of vfolders) {
        if (vf.references(filePath) || vf.referencesArchive(filePath)) {
          toRefresh.add(vf);
        }
      }
    }
    for (const vf of toRefresh) {
      vf.refresh();
    }
  }

  _removeFolder(filename: string, deleteMetaData?: boolean) {
    this.#logger('removeFolder:', filename);
    const folder = this._folders[filename];
    if (folder) {
      // I don't like this but I don't know what order the watches will
      // come in. If a parent comes in before a child then there would
      // be nothing to remove the children since this is a flat heirarchy.
      // (maybe it shouldn't be?). Then, where as the folders normally
      // emit events we're would not receive events because we need to
      // unsubscribe from the folder.

      if (deleteMetaData) {
        folder.folder.deleteData();
      }
      Object.keys(folder.folders).forEach((folderPath: string) => {
        this._removeFolder(folderPath, deleteMetaData);
      });
      Object.keys(folder.archives).forEach((archivePath: string) => {
        this._removeArchive(archivePath, deleteMetaData);
      });
      folder.folder.close();
      folder.folder.removeAllListeners();
      delete this._folders[filename];
      const parent = this._folders[path.dirname(filename)] || this._rootFolder;
      delete parent.folders[filename];
      delete this.#updateFilesPendingFolders[filename];
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      const folders: Record<string, {}> = {};
      folders[filename] = {};
      this.emit('updateFiles', folders);
    }
  }

  _updateFolders(folderPath: string, folders: Record<string, unknown>) {
    this.#logger('updateFolders:', folderPath, folders);
    const folder = this._folders[folderPath];
    const oldFolderNames = Object.keys(folder.folders);
    const newFolderNames = Object.keys(folders);
    const removedFolderNames = arrayInANotB(oldFolderNames, newFolderNames);
    const addedFolderNames = arrayInANotB(newFolderNames, oldFolderNames);

    removedFolderNames.forEach((folderName) => {
      this._removeFolder(folderName, true);
    });
    addedFolderNames.forEach((folderName) => {
      this._addFolder(folderName);
    });
  }

  _updateFiles(folderName: string, folder: SentFolder) {
    this.#logger('updateFiles', folderName);
    const folders = this._prepFilesForSending(folderName, folder as SentFolder);
    Object.assign(this.#updateFilesPendingFolders, folders);
    this._emitUpdateFiles();
  }

  _emitUpdateFiles() {
    const folders = this.#updateFilesPendingFolders;
    this.#updateFilesPendingFolders = {};
    this.emit('updateFiles', folders);
  }

  _prepFilesForSending(folderName: string, folder: SentFolder) {
    const folders: Record<string, SentFolder> = {};
    const newFiles: FilesByPath = {};
    const files = folder.files;
    for (const [filename, fileInfo] of Object.entries(files)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newFiles[filename] = { ...fileInfo, displayName: this._createDisplayPath(filename) } as any;
    }
    folders[folderName] = { ...folder, files: newFiles } as SentFolder;
    return folders;
  }

  _createDisplayPath(filename: string) {
    let base = '';
    for (const baseFolderName of this.#baseFolderNames) {
      if (filename.startsWith(baseFolderName) && baseFolderName.length > base.length) {
        base = baseFolderName;
      }
    }
    return filename.substring(base.length);
  }

  // Originally I planned to make archives a kind of virtual folder but for the time being
  // they seem to work someone differently. Maybe I can refactor later
  _addArchive(filename: string, needUpdate?: boolean) {
    this.#logger('addArchive:', filename);
    const archiveFolder = this._archives[filename];
    if (!archiveFolder) {
      const folderData = new FolderData(filename, { fs: this.#fs, dataDir: this.#dataDir });
      const archiveOptions: {
        folderData: FolderData;
        fs: FsApi;
        thumbnailPageMakerFn: (filepath: string, baseFilename: string) => Promise<FilesByPath>;
      } = {
        folderData,
        fs: this.#fs,
        thumbnailPageMakerFn: this.#archiveThumbnailPageMakerFn,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const af = this.#archiveFolderFactory(filename, archiveOptions as any);
      const folderInfo: FolderInfo = {
        folder: af,
        folders: {}, // this smells. Like `Folder` should handle this?
        archives: {}, // this smells. Like `Folder` should handle it?
      };
      this._archives[filename] = folderInfo;
      const parent = this._folders[path.dirname(filename)] || this._rootFolder;
      parent.archives[filename] = folderInfo;

      af.on('updateFiles', this._updateFiles);
    }
    if (needUpdate) {
      const af = this._archives[filename];
      // `update` exists on ArchiveFolder; assert the folder is an ArchiveFolder
      (af.folder as ArchiveFolderInst).update();
    }
    return this._archives[filename];
  }

  _removeArchive(filename: string, deleteMetaData?: boolean) {
    this.#logger('removeArchive', filename);
    const arc = this._archives[filename];
    if (arc) {
      if (deleteMetaData) {
        /* const childNames = */ arc.folder.deleteData();
      }
      arc.folder.removeAllListeners();
      arc.folder.close();
      delete this._archives[filename];
      const parent = this._folders[path.dirname(filename)] || this._rootFolder;
      delete parent.archives[filename];
      delete this.#updateFilesPendingFolders[filename];
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      const archives: Record<string, {}> = {};
      archives[filename] = {};
      this.emit('updateFiles', archives);
    }
  }

  _updateArchives(folderPath: string, archives: Record<string, unknown>, archiveFilenamesThatNeedUpdate: string[]) {
    this.#logger('updateArchive:', folderPath);
    const folder = this._folders[folderPath];
    const oldArchiveNames = Object.keys(folder.archives);
    const newArchiveNames = Object.keys(archives);
    const removedArchiveNames = arrayInANotB(oldArchiveNames, newArchiveNames);
    const addedArchiveNames = arrayInANotB(newArchiveNames, oldArchiveNames);

    removedArchiveNames.forEach((archiveName) => {
      this._removeArchive(archiveName);
    });
    addedArchiveNames.forEach((archiveName) => {
      const needUpdate = archiveFilenamesThatNeedUpdate.indexOf(archiveName) >= 0;
      this._addArchive(archiveName, needUpdate);
    });
  }

  // ── Virtual folders ────────────────────────────────────────────────
  // A virtual folder is a user-curated list of real file paths shown like a folder
  // under a synthetic `vfolder:<id>` key. Owned entirely here (not in prefs): the
  // index JSON is the source of truth, each folder's membership is a vfolder-*.json.

  _createVirtualFolder(id: string): VirtualFolderInst {
    // The index is the authoritative source of the display name; make sure the
    // definition (which getData() reports as status.name) matches it.
    const name = this.#virtualFolderIndex.getName(id);
    const def = new VirtualFolderData(id, { fs: this.#fs, dataDir: this.#dataDir, name });
    if (name && def.name !== name) {
      def.setName(name);
    }
    // The thumbnail cache is a separate FolderData with a distinct prefix so it
    // doesn't collide with the definition JSON or with real folders' caches.
    const cache = new FolderData(id, { fs: this.#fs, dataDir: this.#dataDir, prefix: 'vfolder-cache' });
    const vf = this.#virtualFolderFactory(id, {
      def,
      cache,
      thumbnailPageMakerFn: this.#folderThumbnailPageMakerFn,
      archiveThumbnailPageMakerFn: this.#archiveThumbnailPageMakerFn,
      fs: this.#fs,
    });
    this._virtualFolders[id] = vf;
    vf.on('updateFiles', this._updateFiles);
    return vf;
  }

  // Instantiate everything already registered in the index (call at startup).
  loadVirtualFolders() {
    for (const { id } of this.#virtualFolderIndex.list()) {
      if (!this._virtualFolders[id]) {
        this._createVirtualFolder(id);
      }
    }
  }

  listVirtualFolders(): VirtualFolderEntry[] {
    return this.#virtualFolderIndex.list();
  }

  getRecentVirtualFolders(): VirtualFolderEntry[] {
    return this.#virtualFolderIndex.getRecent();
  }

  createVirtualFolder(name: string): string {
    // Names are unique (case-insensitive). If one already exists, reuse it rather
    // than creating a duplicate — so "add to new folder 'foo'" adds to the foo
    // that's already there.
    const wanted = name.trim().toLowerCase();
    const existing = this.#virtualFolderIndex.list().find(f => f.name.trim().toLowerCase() === wanted);
    if (existing) {
      return existing.id;
    }
    const id = randomUUID();
    this.#virtualFolderIndex.add(id, name);
    this._createVirtualFolder(id);
    return id;
  }

  // Rename a virtual folder. Rejects (returns false) a name already used by another
  // virtual folder (case-insensitive), mirroring the OS rejecting a duplicate dir.
  renameVirtualFolder(id: string, name: string): boolean {
    const wanted = name.trim();
    if (!wanted) return false;
    const lower = wanted.toLowerCase();
    const clash = this.#virtualFolderIndex.list()
      .some(f => f.id !== id && f.name.trim().toLowerCase() === lower);
    if (clash) return false;
    this.#virtualFolderIndex.rename(id, wanted);
    this._virtualFolders[id]?.setName(wanted);
    return true;
  }

  deleteVirtualFolder(id: string) {
    const vf = this._virtualFolders[id];
    if (vf) {
      vf.deleteData();
      vf.close();
      vf.removeAllListeners();
      delete this._virtualFolders[id];
      delete this.#updateFilesPendingFolders[makeVirtualFolderKey(id)];
    }
    this.#virtualFolderIndex.remove(id);
    // Tell the view the folder is gone.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    const folders: Record<string, {}> = {};
    folders[makeVirtualFolderKey(id)] = {};
    this.emit('updateFiles', folders);
  }

  // Entries are either plain files ({path}) or archive members ({path, archiveName}),
  // where `path` is the composite path.join(archiveName, entryName).
  addFilesToVirtualFolder(id: string, entries: VirtualFolderAddEntry[]) {
    const vf = this._virtualFolders[id];
    if (!vf) {
      this.#logger('no such virtual folder:', id);
      return;
    }
    const nativePaths: string[] = [];
    const archiveRefs: { archiveName: string; entryName: string }[] = [];
    for (const e of entries) {
      if (e.archiveName) {
        archiveRefs.push({ archiveName: e.archiveName, entryName: path.relative(e.archiveName, e.path) });
      } else {
        nativePaths.push(e.path);
      }
    }
    if (nativePaths.length) vf.addFiles(nativePaths);
    if (archiveRefs.length) vf.addArchiveFiles(archiveRefs);
    this.#virtualFolderIndex.noteRecent(id);
  }

  removeFileFromVirtualFolder(id: string, filePath: string) {
    const vf = this._virtualFolders[id];
    if (vf) {
      vf.removeFiles([filePath]);
    }
  }

  // Proactively remove a single file and update listeners without waiting for
  // a filesystem watcher event. Used by the delete flow so the thumbnail
  // disappears immediately (important on network drives where the filesystem
  // watcher may not fire). Returns true if the file was found and removed.
  removeFile(filePath: string): boolean {
    this.#logger('removeFile:', filePath);
    let removed = false;
    // Check if this file is an archive entry tracked at the top level
    if (this._archives[filePath]) {
      this._removeArchive(filePath, false);
      removed = true;
    } else {
      // Otherwise it lives inside a watched native folder
      const folderInfo = this._folders[path.dirname(filePath)];
      if (folderInfo) {
        (folderInfo.folder as NativeFolderInst).removeFileAndNotify(filePath);
        removed = true;
      }
    }
    // The real file is gone — drop it from every virtual folder that references it,
    // without waiting for anything (mirrors the native force-removal above).
    for (const vf of Object.values(this._virtualFolders)) {
      if (vf.references(filePath)) {
        vf.removeFileAndNotify(filePath);
        removed = true;
      }
    }
    return removed;
  }
}
