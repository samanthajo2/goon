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
import { throttle, arrayDifference } from '../../lib/utils';
import bind from '../../lib/bind';
import debug from '../../lib/debug';
import NativeFolder from './native-folder';
import ArchiveFolder from './archive-folder';
import createThumbnailsForFolder, { ThumbnailPageMakerFn } from './folder-thumbnail-maker';
import createThumbnailsForArchive from './archive-thumbnail-maker';
import WatcherConsolidator from './watcher-consolidator';
import FolderData from './folder-data';
import { FilesByPath } from '../../lib/fileinfo';
import { LimitedResourceManager } from '../../lib/limited-resource-manager';
import { MakeThumbnailPagesFn } from './thumbnail-page-maker-def';
import { FolderWatcherInterface } from '../../lib/watcher/folder-watcher';

function arrayInANotB<T>(a: T[], b: T[]) {
  return a.filter((elem) => b.indexOf(elem) < 0);
}

// This runs on the "server" and watches the filesystem
// for changes. It uses a Thumbnailer to generate
// thumbnails

type NativeFolderInst = InstanceType<typeof NativeFolder>;
type ArchiveFolderInst = InstanceType<typeof ArchiveFolder>;

type FolderInfo = {
  folder: NativeFolderInst | ArchiveFolderInst;
  folders: Record<string, FolderInfo>;
  archives: Record<string, FolderInfo>;
};

type RootFolderInfo = {
  folder?: NativeFolderInst | ArchiveFolderInst;
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
  statSync: (path: string) => { mtimeMs: number };
  stat: (path: string, callback: (err: Error | null, stats: { size: number; mtimeMs: number; isDirectory: () => boolean }) => void) => void;
};

type SentFolder = {
  files: FilesByPath;
  status?: {
    scanning?: boolean;
    checking?: boolean;
    scannedTime?: number;
    archive?: boolean;
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
  #archiveThumbnailPageMakerFn: (filepath: string, baseFilename: string) => Promise<FilesByPath>;
  #nativeFolderFactory: Factory<typeof NativeFolder>;
  #archiveFolderFactory: Factory<typeof ArchiveFolder>;

  // not private for testing. Should fix.
  _folders: Record<string, FolderInfo> = {};
  _archives: Record<string, FolderInfo> = {};
  _rootFolder: RootFolderInfo = { folders: {}, archives: {} };

  constructor(options: {
    dataDir: string;
    fs: FsApi;
    watcherFactory: (filePath: string) => FolderWatcherInterface | null;
    nativeFolderFactory: Factory<typeof NativeFolder>;
    archiveFolderFactory: Factory<typeof ArchiveFolder>;
    thumbnailPageMakerManager: LimitedResourceManager<MakeThumbnailPagesFn>;
  }) {
    super();
    this.#dataDir = options.dataDir;
    this.#fs = options.fs;
    this.#watcherFactory = options.watcherFactory;
    this.#nativeFolderFactory = options.nativeFolderFactory;
    this.#archiveFolderFactory = options.archiveFolderFactory;
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
      'refreshFolder',
    );
    this._emitUpdateFiles = throttle(this._emitUpdateFiles.bind(this), 500);
    this.#logger = debug('ThumbnailManager');
    this.#folderThumbnailPageMakerFn = (oldFiles, newFiles, baseFilename) => createThumbnailsForFolder(oldFiles, newFiles, baseFilename, thumbnailPageMakerManager);
    this.#archiveThumbnailPageMakerFn = (filepath, baseFilename) => createThumbnailsForArchive(filepath, baseFilename, thumbnailPageMakerManager);
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
    }
    return folder;
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

  // Proactively remove a single file and update listeners without waiting for
  // a filesystem watcher event. Used by the trash flow so the thumbnail
  // disappears immediately (important on network drives where chokidar may
  // not fire). Returns true if the file was found and removed.
  removeFile(filePath: string): boolean {
    this.#logger('removeFile:', filePath);
    // Check if this file is an archive entry tracked at the top level
    if (this._archives[filePath]) {
      this._removeArchive(filePath, false);
      return true;
    }
    // Otherwise it lives inside a watched native folder
    const folderPath = path.dirname(filePath);
    const folderInfo = this._folders[folderPath];
    if (folderInfo) {
      (folderInfo.folder as NativeFolderInst).removeFileAndNotify(filePath);
      return true;
    }
    return false;
  }
}
