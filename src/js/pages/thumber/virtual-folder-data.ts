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

// Persistence for a single virtual folder's *definition*: an ordered list of the
// absolute file paths a user has curated. Stored as `vfolder-<sha256(id)>.json` in
// the same dataDir as the folder-*.json caches, mirroring FolderData's versioned,
// debounced-write pattern. This is definition-only — the generated thumbnail
// FileInfo cache is a separate concern handled by VirtualFolder (Phase 2).

import path from 'node:path';
import debug, { Logger } from '../../lib/debug.js';
import bind from '../../lib/bind.js';
import { createBasename, debounce, CancelableFn } from '../../lib/utils.js';

const s_saveDebounceDuration = 2000;
const s_version = 2;

export type VirtualFolderFsAPI = {
  existsSync: (path: string) => boolean;
  readFileAsStringSync: (path: string) => string;
  writeFileSync: (path: string, data: string | Buffer) => void;
  unlinkSync: (path: string) => void;
};

// A referenced entry inside an archive. `entryName` is the archive-internal (safe)
// name; the composite display path — matching the view's info.filename and the
// archive thumbnail cache key — is path.join(archiveName, entryName).
export type ArchiveRef = { archiveName: string; entryName: string };

export function archiveRefPath(ref: ArchiveRef): string {
  return path.join(ref.archiveName, ref.entryName);
}

type VirtualFolderJson = {
  version: number;
  id: string;
  name: string;
  files: string[];        // absolute filesystem paths
  archives: ArchiveRef[]; // entries that live inside archive files
};

// Version migrations (bump s_version and add an entry when the shape changes,
// same as FolderData.versionConverters).
const versionConverters: Record<number, (data: VirtualFolderJson) => VirtualFolderJson> = {
  // v1 had no archive entries.
  1: (data) => ({ ...data, version: 2, archives: [] }),
};

export default class VirtualFolderData {
  #logger: Logger;
  #fs: VirtualFolderFsAPI;
  #baseFilename: string;
  #jsonFilename: string;
  #fileExists = false;
  #deleted = false;
  #data: VirtualFolderJson;
  #queueWrite: CancelableFn;

  constructor(id: string, options: {
    fs: VirtualFolderFsAPI;
    dataDir: string;
    name?: string;
    readOnly?: boolean;
  }) {
    this.#logger = debug('VirtualFolderData', id);
    this.#fs = options.fs;
    bind(this, '_save');
    if (options.readOnly) {
      this.#deleted = true; // cheap way to make _save a no-op without a second flag
    }
    this.#baseFilename = createBasename(options.dataDir, 'vfolder', id);
    this.#jsonFilename = `${this.#baseFilename}.json`;
    this.#data = { version: s_version, id, name: options.name ?? id, files: [], archives: [] };
    this.#queueWrite = debounce(this._save, s_saveDebounceDuration);
    if (this.#fs.existsSync(this.#jsonFilename)) {
      try {
        let data = JSON.parse(this.#fs.readFileAsStringSync(this.#jsonFilename)) as VirtualFolderJson;
        this.#fileExists = true;
        while (data.version !== s_version) {
          const converter = versionConverters[data.version];
          if (!converter) {
            throw new Error(`bad version: ${data.version}`);
          }
          data = converter(data);
          this.#queueWrite();
        }
        this.#data = data;
      } catch (e) {
        console.error('could not read:', this.#jsonFilename, e);
        this.#queueWrite();
      }
    }
  }

  get id(): string { return this.#data.id; }
  get name(): string { return this.#data.name; }
  get baseFilename(): string { return this.#baseFilename; }
  get files(): string[] { return this.#data.files; }
  get archives(): ArchiveRef[] { return this.#data.archives; }
  get exists(): boolean { return this.#fileExists; }

  setName(name: string): boolean {
    if (this.#data.name === name) {
      return false;
    }
    this.#data.name = name;
    this.#queueWrite();
    return true;
  }

  // Append paths, preserving insertion order and skipping any already present.
  // Returns true if anything was added.
  addFiles(paths: string[]): boolean {
    const have = new Set(this.#data.files);
    let changed = false;
    for (const p of paths) {
      if (!have.has(p)) {
        have.add(p);
        this.#data.files.push(p);
        changed = true;
      }
    }
    if (changed) {
      this.#queueWrite();
    }
    return changed;
  }

  // Append archive entries, skipping any already present. Returns true if anything
  // was added. Identity is the composite path (archive + entry).
  addArchiveFiles(refs: ArchiveRef[]): boolean {
    const have = new Set(this.#data.archives.map(archiveRefPath));
    let changed = false;
    for (const ref of refs) {
      const key = archiveRefPath(ref);
      if (!have.has(key)) {
        have.add(key);
        this.#data.archives.push(ref);
        changed = true;
      }
    }
    if (changed) {
      this.#queueWrite();
    }
    return changed;
  }

  // Remove members by composite display path. Handles both plain files and archive
  // entries (whose composite path is path.join(archiveName, entryName)). Returns
  // true if anything was removed.
  removeFiles(paths: string[]): boolean {
    const remove = new Set(paths);
    const before = this.#data.files.length + this.#data.archives.length;
    this.#data.files = this.#data.files.filter(p => !remove.has(p));
    this.#data.archives = this.#data.archives.filter(ref => !remove.has(archiveRefPath(ref)));
    const changed = (this.#data.files.length + this.#data.archives.length) !== before;
    if (changed) {
      this.#queueWrite();
    }
    return changed;
  }

  deleteData(): void {
    this.#queueWrite.cancel();
    this.#deleted = true;
    if (this.#fileExists) {
      try {
        this.#fs.unlinkSync(this.#jsonFilename);
      } catch (e) {
        this.#logger.error(e);
      }
      this.#fileExists = false;
    }
  }

  // Write immediately, bypassing the debounce (use on shutdown / in tests).
  flush(): void {
    this.#queueWrite.cancel();
    this._save();
  }

  _save(): void {
    if (this.#deleted) {
      return;
    }
    this.#logger('writing:', this.#jsonFilename);
    this.#fs.writeFileSync(this.#jsonFilename, JSON.stringify(this.#data, null, 2));
    this.#fileExists = true;
  }
}
