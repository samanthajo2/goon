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
import { areFilesSame, createBasename } from '../../lib/utils.js';
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
import { archiveRefPath } from './virtual-folder-data.js';
import type { BaseFolder } from './base-folder.js';
import { makeVirtualFolderKey } from './virtual-folder-key.js';

// Regenerates thumbnails for specific media entries inside an archive, keyed by
// each entry's composite path (path.join(archiveName, entryName)).
export type ArchiveThumbnailPageMakerFn = (
  archiveName: string,
  baseFilename: string,
  entryNames: string[],
) => Promise<FilesByPath>;

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
  #archiveThumbnailPageMakerFn: ArchiveThumbnailPageMakerFn;
  #fs: LocalFsAPI;
  #isMakingThumbnails = false;
  #pendingRefresh = false;

  constructor(id: string, options: {
    def: VirtualFolderData;
    cache: FolderData;
    thumbnailPageMakerFn: ThumbnailPageMakerFn;
    archiveThumbnailPageMakerFn: ArchiveThumbnailPageMakerFn;
    fs: LocalFsAPI;
  }) {
    super();
    this.#id = id;
    this.#filename = makeVirtualFolderKey(id);
    this.#logger = debug('VirtualFolder', id);
    this.#def = options.def;
    this.#cache = options.cache;
    this.#thumbnailPageMakerFn = options.thumbnailPageMakerFn;
    this.#archiveThumbnailPageMakerFn = options.archiveThumbnailPageMakerFn;
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

  // Add referenced archive entries (each `{archiveName, entryName}`) to this virtual
  // folder, then reconcile + generate thumbnails from the archive.
  addArchiveFiles(refs: { archiveName: string; entryName: string }[]): void {
    if (this.#def.addArchiveFiles(refs)) {
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

  // True if this virtual folder references the given file — either a real file path
  // or an archive entry's composite path (path.join(archiveName, entryName)).
  references(filePath: string): boolean {
    return this.#def.files.includes(filePath)
      || this.#def.archives.some(ref => archiveRefPath(ref) === filePath);
  }

  // True if this virtual folder references any entry inside the given archive file.
  referencesArchive(archiveName: string): boolean {
    return this.#def.archives.some(ref => ref.archiveName === archiveName);
  }

  // Change the display name (from a user rename) and re-broadcast so the view
  // relabels the folder immediately.
  setName(name: string): void {
    if (this.#def.setName(name)) {
      this._emitCurrent();
    }
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

    // ── Native files ──
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

    // The desired native media set: freshly-stat'd present media, plus offline media
    // kept from cache exactly as-is (so the page maker copies their thumbnails
    // forward instead of dropping them). Stat-only entries get their thumbnails made.
    const nativeDesired: FilesByPath = { ...separateFiles(present).imagesAndVideos };
    const presentOrGone = new Set([...Object.keys(present), ...trulyGone]);
    for (const p of this.#def.files) {
      if (presentOrGone.has(p)) {
        continue;
      }
      const cached = this.#cache.files[p];
      if (cached) {
        nativeDesired[p] = cached; // offline — unchanged, copied forward
      }
    }

    // ── Archive entries ──
    // For each referenced archive: if present, keep cache entries whose archiveMtime
    // still matches (up to date), and mark the rest stale for regeneration. If the
    // archive is confirmed gone, prune its entries; if merely offline, keep cache.
    const archiveKeep: FilesByPath = {};
    const archiveGone: string[] = [];
    const toRegen = new Map<string, { entryNames: string[]; mtime: number }>();
    const refsByArchive = new Map<string, { archiveName: string; entryName: string }[]>();
    for (const ref of this.#def.archives) {
      const list = refsByArchive.get(ref.archiveName) ?? [];
      list.push(ref);
      refsByArchive.set(ref.archiveName, list);
    }
    for (const [archiveName, refs] of refsByArchive) {
      let mtime: number | undefined;
      try {
        mtime = this.#fs.statSync(archiveName).mtimeMs;
      } catch {
        mtime = undefined;
      }
      if (mtime === undefined) {
        if (this.#fs.existsSync(path.dirname(archiveName))) {
          for (const ref of refs) archiveGone.push(archiveRefPath(ref)); // confirmed gone
        } else {
          for (const ref of refs) { // offline — keep whatever we cached
            const cp = archiveRefPath(ref);
            if (this.#cache.files[cp]) archiveKeep[cp] = this.#cache.files[cp];
          }
        }
        continue;
      }
      const stale: string[] = [];
      for (const ref of refs) {
        const cp = archiveRefPath(ref);
        const cached = this.#cache.files[cp];
        if (cached && cached.archiveMtime === mtime) {
          archiveKeep[cp] = cached; // up to date
        } else {
          stale.push(ref.entryName);
        }
      }
      if (stale.length) toRegen.set(archiveName, { entryNames: stale, mtime });
    }
    if (archiveGone.length) {
      this.#logger('pruning gone archive entries:', archiveGone);
      this.#def.removeFiles(archiveGone);
    }

    // ── Reconcile against the cache ──
    const oldMedia = separateFiles(this.#cache.files).imagesAndVideos;
    const oldNativeMedia: FilesByPath = {};
    for (const [k, v] of Object.entries(oldMedia)) {
      if (!v.archiveName) oldNativeMedia[k] = v;
    }
    const regenPaths = new Set<string>();
    for (const [archiveName, { entryNames }] of toRegen) {
      for (const entryName of entryNames) regenPaths.add(path.join(archiveName, entryName));
    }
    // Drop cache media no longer wanted (removed from the folder, gone, or stale).
    const desiredKeys = new Set([
      ...Object.keys(nativeDesired),
      ...Object.keys(archiveKeep),
      ...regenPaths,
    ]);
    const removed = Object.keys(oldMedia).filter(k => !desiredKeys.has(k));
    if (removed.length) {
      this.#cache.removeFiles(removed);
    }

    const nativeNeedsWork = !areFilesSame(oldNativeMedia, nativeDesired);
    const archiveNeedsWork = toRegen.size > 0;
    if (!nativeNeedsWork && !archiveNeedsWork) {
      // Nothing to regenerate, but we *have* reconciled. Mark it scanned so a
      // brand-new empty virtual folder is distinguishable from a removed one (which
      // emits no scannedTime) and shows under "Show Empty Folders".
      if (!this.#cache.scannedTime) {
        this.#cache.setScannedTime();
      }
      this._emitCurrent();
    } else {
      await this._makeThumbnails(oldNativeMedia, nativeDesired, nativeNeedsWork, toRegen);
    }

    if (this.#pendingRefresh) {
      this.#pendingRefresh = false;
      this.refresh();
    }
  }

  async _makeThumbnails(
    oldNativeMedia: FilesByPath,
    nativeDesired: FilesByPath,
    nativeNeedsWork: boolean,
    toRegen: Map<string, { entryNames: string[]; mtime: number }>,
  ): Promise<void> {
    this.#isMakingThumbnails = true;
    this._emitCurrent(); // scanning = true
    try {
      if (nativeNeedsWork) {
        const files = await this.#thumbnailPageMakerFn(oldNativeMedia, nativeDesired, this.#cache.baseFilename);
        this.#cache.addFiles(files);
      }
      for (const [archiveName, { entryNames, mtime }] of toRegen) {
        try {
          // A distinct page-set per archive keeps archive tiles out of the native
          // pages and lets deleteData() clean them up with the rest of the cache.
          const baseFilename = `${this.#cache.baseFilename}-${createBasename('', 'arc', archiveName)}`;
          const files = await this.#archiveThumbnailPageMakerFn(archiveName, baseFilename, entryNames);
          for (const info of Object.values(files)) {
            info.archiveMtime = mtime; // so a later refresh can skip an unchanged archive
          }
          this.#cache.addFiles(files);
        } catch (e) {
          console.warn(`could not make thumbnails for archive in virtual folder: ${archiveName}`, e);
        }
      }
    } catch (e) {
      console.warn(`could not make thumbnails for virtual folder: ${this.#id}`, e);
    } finally {
      this.#isMakingThumbnails = false;
      this.#cache.setScannedTime();
    }
    this._emitCurrent();
  }
}
