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

// The thumber-owned registry of virtual folders: which ones exist (id + display
// name, in registration order) and a most-recently-added-to list (for the "Add to
// Recent Virtual Folder" submenu). A singleton JSON in dataDir. Virtual folders
// have nothing to do with prefs; this is their source of truth.

import path from 'node:path';
import debug, { Logger } from '../../lib/debug.js';
import bind from '../../lib/bind.js';
import { debounce, CancelableFn } from '../../lib/utils.js';
import type { VirtualFolderFsAPI } from './virtual-folder-data.js';

const s_saveDebounceDuration = 2000;
const s_version = 1;
const s_maxRecent = 5;
const s_indexFilename = 'virtual-folders.json';

export type VirtualFolderEntry = { id: string; name: string };

type IndexJson = {
  version: number;
  folders: VirtualFolderEntry[]; // registration order
  recent: string[];              // ids, most-recent first, at most s_maxRecent
};

// Version migrations (none yet).
const versionConverters: Record<number, (data: IndexJson) => IndexJson> = {};

export default class VirtualFolderIndex {
  #logger: Logger;
  #fs: VirtualFolderFsAPI;
  #jsonFilename: string;
  #data: IndexJson;
  #queueWrite: CancelableFn;

  constructor(options: { fs: VirtualFolderFsAPI; dataDir: string }) {
    this.#logger = debug('VirtualFolderIndex');
    this.#fs = options.fs;
    bind(this, '_save');
    this.#jsonFilename = path.join(options.dataDir, s_indexFilename);
    this.#data = { version: s_version, folders: [], recent: [] };
    this.#queueWrite = debounce(this._save, s_saveDebounceDuration);
    if (this.#fs.existsSync(this.#jsonFilename)) {
      try {
        let data = JSON.parse(this.#fs.readFileAsStringSync(this.#jsonFilename)) as IndexJson;
        while (data.version !== s_version) {
          const converter = versionConverters[data.version];
          if (!converter) {
            throw new Error(`bad version: ${data.version}`);
          }
          data = converter(data);
          this.#queueWrite();
        }
        // Be defensive about a hand-edited / partial file.
        this.#data = {
          version: s_version,
          folders: Array.isArray(data.folders) ? data.folders : [],
          recent: Array.isArray(data.recent) ? data.recent : [],
        };
      } catch (e) {
        console.error('could not read:', this.#jsonFilename, e);
        this.#queueWrite();
      }
    }
  }

  list(): VirtualFolderEntry[] {
    return this.#data.folders.map(f => ({ ...f }));
  }

  has(id: string): boolean {
    return this.#data.folders.some(f => f.id === id);
  }

  getName(id: string): string | undefined {
    return this.#data.folders.find(f => f.id === id)?.name;
  }

  // Register a new virtual folder (or update the name of an existing one).
  add(id: string, name: string): void {
    const existing = this.#data.folders.find(f => f.id === id);
    if (existing) {
      if (existing.name !== name) {
        existing.name = name;
        this.#queueWrite();
      }
      return;
    }
    this.#data.folders.push({ id, name });
    this.#queueWrite();
  }

  rename(id: string, name: string): void {
    const existing = this.#data.folders.find(f => f.id === id);
    if (existing && existing.name !== name) {
      existing.name = name;
      this.#queueWrite();
    }
  }

  remove(id: string): void {
    const before = this.#data.folders.length;
    this.#data.folders = this.#data.folders.filter(f => f.id !== id);
    const wasRecent = this.#data.recent.includes(id);
    this.#data.recent = this.#data.recent.filter(r => r !== id);
    if (this.#data.folders.length !== before || wasRecent) {
      this.#queueWrite();
    }
  }

  // Move an id to the front of the recent list (most-recently-added-to), trimmed
  // to s_maxRecent. No-op for unknown ids.
  noteRecent(id: string): void {
    if (!this.has(id)) {
      return;
    }
    this.#data.recent = [id, ...this.#data.recent.filter(r => r !== id)].slice(0, s_maxRecent);
    this.#queueWrite();
  }

  // Recent entries, most-recent first, resolved to {id, name} and skipping any
  // ids no longer registered.
  getRecent(): VirtualFolderEntry[] {
    const result: VirtualFolderEntry[] = [];
    for (const id of this.#data.recent) {
      const name = this.getName(id);
      if (name !== undefined) {
        result.push({ id, name });
      }
    }
    return result;
  }

  // Write immediately, bypassing the debounce (use on shutdown / in tests).
  flush(): void {
    this.#queueWrite.cancel();
    this._save();
  }

  _save(): void {
    this.#logger('writing:', this.#jsonFilename);
    this.#fs.writeFileSync(this.#jsonFilename, JSON.stringify(this.#data, null, 2));
  }
}
