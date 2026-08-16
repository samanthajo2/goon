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

import debug, { Logger } from '../../lib/debug.js';
import bind from '../../lib/bind.js';
import { createBasename, debounce, isDeepEqual } from '../../lib/utils.js';
import { FileInfo } from '../../lib/fileinfo.js';

const s_saveDebounceDuration = 2000;
const s_folderVersion = 7;

type LocalFsAPI = {
  existsSync: (path: string) => boolean;
  readdir: (path: string, callback: (err: NodeJS.ErrnoException | null, files: string[]) => void) => void;
  readFileAsStringSync: (path: string) => string;
  unlinkSync: (path: string) => void;
  writeFileSync: (path: string, data: string | Buffer) => void;
};

// Convert a v6 thumbnail.url (URL-encoded path with optional `?cache=N`
// suffix, sometimes prefixed with `file:///`) back to a raw absolute path
// with the cache suffix preserved. v7 stores raw paths so consumers can
// translate per-platform via Platform.fileToUrl at render time.
function decodeOldThumbnailUrl(url: string): string {
  let s = url;
  if (s.startsWith('file:///')) {
    // Mac/Linux: file:///abs/path → /abs/path (keep leading slash).
    // Windows: file:///C:/path → C:/path (drop leading slash).
    s = /^file:\/\/\/[A-Z]:[/\\]/i.test(s) ? s.slice(8) : s.slice(7);
  }
  const qIdx = s.indexOf('?');
  const query = qIdx >= 0 ? s.slice(qIdx) : '';
  const bare = qIdx >= 0 ? s.slice(0, qIdx) : s;
  try { return decodeURIComponent(bare) + query; } catch { return s; }
}

// TODO: figure out a better way type this. Or use ajv or something?
const versionConverters: Record<string, (data: unknown, filepath: string) => unknown> = {
  6: (data: unknown) => {
    const d = data as { version: number; files: Record<string, FileInfo> };
    for (const file of Object.values(d.files)) {
      if (file.thumbnail && typeof file.thumbnail.url === 'string') {
        file.thumbnail.url = decodeOldThumbnailUrl(file.thumbnail.url);
      }
    }
    d.version = 7;
    return d;
  },
};

export default class FolderData {
  #logger: Logger;
  #filepath: string;
  #fs: LocalFsAPI;
  #fileExists: boolean;
  #baseFilename: string;
  #jsonFilename: string;
  #data: {
    version: number;
    folderPath: string;
    files: Record<string, FileInfo>;
    scannedTime?: number;
    dirMtime?: number;
  }
  #queueWrite: () => void;

  constructor(filepath: string, options: {
    fs: LocalFsAPI;
    dataDir: string;
    readOnly?: boolean;
    // Cache-file prefix. Defaults to 'folder' (folder-<hash>.json / _N.png). Virtual
    // folders pass a distinct prefix so their thumbnail cache doesn't collide with
    // real folders or with the virtual-folder *definition* JSON (vfolder-<hash>.json).
    prefix?: string;
  }) {
    this.#logger = debug('FolderData', filepath);
    this.#filepath = filepath;
    this.#fs = options.fs;
    bind(
      this,
      '_save',
    );
    if (options.readOnly) {
      this._save = () => {};
    }
    this.#fileExists = false;
    this.#baseFilename = createBasename(options.dataDir, options.prefix ?? 'folder', this.#filepath);
    this.#jsonFilename = `${this.#baseFilename}.json`;
    this.#data = {
      version: s_folderVersion,
      folderPath: filepath,
      files: {},
    };
    this.#queueWrite = debounce(this._save, s_saveDebounceDuration);  // save if we haven't added anything in 1 second
    this.#logger('checking:', this.#jsonFilename);
    if (this.#fs.existsSync(this.#jsonFilename)) {
      this.#logger('read:', this.#jsonFilename);
      try {
        const json = this.#fs.readFileAsStringSync(this.#jsonFilename);
        this.#fileExists = true;
        let data = JSON.parse(json as string);
        while (data.version !== s_folderVersion) {
          const converter = versionConverters[data.version];
          if (!converter) {
            throw new Error('bad version');
          }
          data = converter(data, filepath);
          this.#queueWrite();
        }
        this.#data = data;
      } catch (e) {
        console.error('could not read:', this.#jsonFilename, e);
        this.#queueWrite();
      }
    }
  }
  get files() {
    return this.#data.files;
  }
  get baseFilename() {
    return this.#baseFilename;
  }
  get scannedTime() {
    return this.#data.scannedTime;
  }
  get dirMtime() {
    return this.#data.dirMtime;
  }
  setDirMtime(mtime: number) {
    if (this.#data.dirMtime !== mtime) {
      this.#data.dirMtime = mtime;
      this.#queueWrite();
    }
  }
  get exists() {
    return this.#fileExists;
  }
  deleteData() {
    if (this.#fileExists) {
      // should I trap this?
      try {
        this.#fs.unlinkSync(this.#jsonFilename);
      } catch (e) {
        this.#logger.error(e);
      }
    }
    this._save = () => {};
  }
  _save() {
    this.#logger('writing:', this.#jsonFilename);
    this.#fs.writeFileSync(
      this.#jsonFilename,
      JSON.stringify(this.#data, null, 2),
    );
    this.#fileExists = true;
  }
  addFiles(files: Record<string, FileInfo>) {
    let changed = false;
    for (const [filePath, fileInfo] of Object.entries(files)) {
      if (!isDeepEqual(this.#data.files[filePath], fileInfo)) {
        changed = true;
        this.#data.files[filePath] = fileInfo;
      }
    }
    if (changed) {
      this.#queueWrite();
    }
  }
  setScannedTime(time?: number) {
    this.#data.scannedTime = time ?? Date.now();
    this.#queueWrite();
  }
  removeFiles(filepaths: string[]) {
    let changed = false;
    for (const filepath of filepaths) {
      if (this.#data.files[filepath]) {
        changed = true;
        delete this.#data.files[filepath];
      }
    }
    if (changed) {
      this.#queueWrite();
    }
  }
}
