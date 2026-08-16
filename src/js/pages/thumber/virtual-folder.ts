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

// A user-curated "virtual" folder. It references media files that live in their
// real locations; the virtual folder just points at them. It implements the same
// BaseFolder interface as NativeFolder/ArchiveFolder so the ThumbnailManager and the
// view treat it like any other folder (under a synthetic `vfolder:<id>` key).
//
// Unlike NativeFolder it has no filesystem watcher — its membership is an explicit
// path list (VirtualFolderData). refresh() stats those paths and regenerates only
// the thumbnails that changed, into its own page PNGs (via a separate FolderData
// cache). A referenced file is pruned from the folder only when it is confirmed gone
// (its containing directory is present but the file is not) — a file on an offline
// volume is kept, mirroring how SimpleFolderWatcher only prunes after a successful
// readdir.

import EventEmitter from 'node:events';
import path from 'node:path';
import debug, { Logger } from '../../lib/debug.js';
import bind from '../../lib/bind.js';
import { areFilesSame, getDifferentFilenames } from '../../lib/utils.js';
import { FileInfo, FilesByPath } from '../../lib/fileinfo.js';
import {
  getImagesAndVideos,
  getSeparateFilenames,
  deleteThumbnails,
  separateFiles,
} from './folder-utils.js';
import { ThumbnailPageMakerFn } from './folder-thumbnail-maker.js';
import type FolderData from './folder-data.js';
import type VirtualFolderData from './virtual-folder-data.js';
import type { BaseFolder } from './base-folder.js';
import { makeVirtualFolderKey } from './virtual-folder-key.js';

type LocalFsAPI = {
  statSync: (p: string) => { size: number; mtimeMs: number; isDirectory: () => boolean };
  existsSync: (p: string) => boolean;
  unlinkSync: (filename: string) => void;
};

// A partial (stat-only) entry, as produced from a fresh stat. The page maker fills
// in the rest (type/width/height/thumbnail). Same shape the folder watcher emits.
function statEntry(st: { size: number; mtimeMs: number; isDirectory: () => boolean }): FileInfo {
  return { size: st.size, mtime: st.mtimeMs, isDirectory: st.isDirectory() } as unknown as FileInfo;
}

export default class VirtualFolder extends EventEmitter implements BaseFolder {
  emit(event: 'updateFiles', filename: string, data: ReturnType<VirtualFolder['getData']>): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(event: string, ...args: any[]): boolean { return super.emit(event, ...args); }
  on(event: 'updateFiles', fn: (filename: string, data: ReturnType<VirtualFolder['getData']>) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, fn: (...args: any[]) => void): this { return super.on(event, fn); }

  #logger: Logger;
  #id: string;
  #filename: string;
  #def: VirtualFolderData;
  #cache: FolderData;
  #thumbnailPageMakerFn: ThumbnailPageMakerFn;
  #fs: LocalFsAPI;
  #isMakingThumbnails = false;
  #pendingRefresh = false;

  constructor(id: string, options: {
    def: VirtualFolderData;
    cache: FolderData;
    thumbnailPageMakerFn: ThumbnailPageMakerFn;
    fs: LocalFsAPI;
  }) {
    super();
    this.#id = id;
    this.#filename = makeVirtualFolderKey(id);
    this.#logger = debug('VirtualFolder', id);
    this.#def = options.def;
    this.#cache = options.cache;
    this.#thumbnailPageMakerFn = options.thumbnailPageMakerFn;
    this.#fs = options.fs;
    bind(this, 'refresh');

    // Emit whatever we already have cached immediately, then reconcile against disk.
    process.nextTick(() => {
      this._emitCurrent();
      this.refresh();
    });
  }

  get filename(): string {
    return this.#filename;
  }

  get id(): string {
    return this.#id;
  }

  getData() {
    return {
      files: getImagesAndVideos(this.#cache.files),
      status: {
        scanning: this.#isMakingThumbnails,
        scannedTime: this.#cache.scannedTime,
        virtual: true,
        name: this.#def.name,
      },
    };
  }

  getSeparateFilenames() {
    return getSeparateFilenames(this.#cache.files);
  }

  deleteData() {
    const files = this.#cache.files;
    const names = getSeparateFilenames(files);
    deleteThumbnails(this.#fs, files);
    this.#cache.deleteData();
    this.#def.deleteData();
    return names;
  }

  close() {
    // No watcher to tear down. Persist the (user-curated) membership promptly.
    this.#def.flush();
  }

  // Add referenced files to this virtual folder (does not touch disk), then
  // reconcile + generate thumbnails.
  addFiles(paths: string[]): void {
    if (this.#def.addFiles(paths)) {
      this.refresh();
    }
  }

  // Remove referenced files from this virtual folder only (never deletes the real
  // file on disk). Updates the display immediately — no rescan/regeneration, same
  // as NativeFolder.removeFileAndNotify (the page PNG keeps a now-unused sub-rect
  // until the next regeneration).
  removeFiles(paths: string[]): void {
    this.#def.removeFiles(paths);
    this.#cache.removeFiles(paths);
    this._emitCurrent();
  }

  // Force-remove a single referenced file without waiting for anything — used when
  // the real file was deleted (the ThumbnailManager fans a delete out to every
  // virtual folder that references it). Mirrors NativeFolder.removeFileAndNotify.
  removeFileAndNotify(filePath: string): void {
    this.removeFiles([filePath]);
  }

  // True if this virtual folder references the given real file path.
  references(filePath: string): boolean {
    return this.#def.files.includes(filePath);
  }

  _emitCurrent() {
    this.emit('updateFiles', this.#filename, this.getData());
  }

  async refresh(): Promise<void> {
    if (this.#isMakingThumbnails) {
      // Coalesce: run one more pass after the in-flight generation finishes.
      this.#pendingRefresh = true;
      return;
    }

    // Stat every referenced path. Present files get a fresh stat entry; missing
    // files are pruned only if their containing directory is present (so a file on
    // an offline/unmounted volume is kept, not dropped).
    const present: FilesByPath = {};
    const trulyGone: string[] = [];
    for (const p of this.#def.files) {
      try {
        present[p] = statEntry(this.#fs.statSync(p));
      } catch {
        if (this.#fs.existsSync(path.dirname(p))) {
          trulyGone.push(p);
        }
        // else: volume/parent unavailable → keep the cached entry (offline).
      }
    }

    if (trulyGone.length) {
      this.#logger('pruning gone files:', trulyGone);
      this.#def.removeFiles(trulyGone);
    }

    // The complete desired media set for the cache: freshly-stat'd present media,
    // plus offline media kept from cache exactly as-is (so the page maker copies
    // their thumbnails forward instead of dropping them).
    const oldMedia = separateFiles(this.#cache.files).imagesAndVideos;
    const desired: FilesByPath = { ...separateFiles(present).imagesAndVideos };
    const presentOrGone = new Set([...Object.keys(present), ...trulyGone]);
    for (const p of this.#def.files) {
      if (presentOrGone.has(p)) {
        continue;
      }
      const cached = this.#cache.files[p];
      if (cached) {
        desired[p] = cached; // offline — unchanged, copied forward
      }
    }

    // Drop cache entries that are no longer wanted (removed from the folder or gone).
    const diff = getDifferentFilenames(oldMedia, desired);
    if (diff.removed.length) {
      this.#cache.removeFiles(diff.removed);
    }

    if (areFilesSame(oldMedia, desired)) {
      this._emitCurrent();
    } else {
      await this._makeThumbnails(oldMedia, desired);
    }

    if (this.#pendingRefresh) {
      this.#pendingRefresh = false;
      this.refresh();
    }
  }

  async _makeThumbnails(oldMedia: FilesByPath, desired: FilesByPath): Promise<void> {
    this.#isMakingThumbnails = true;
    this._emitCurrent(); // scanning = true
    try {
      const files = await this.#thumbnailPageMakerFn(oldMedia, desired, this.#cache.baseFilename);
      this.#cache.addFiles(files);
    } catch (e) {
      console.warn(`could not make thumbnails for virtual folder: ${this.#id}`, e);
    } finally {
      this.#isMakingThumbnails = false;
      this.#cache.setScannedTime();
    }
    this._emitCurrent();
  }
}
