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

import _ from 'lodash';
import debug, { Logger } from '../../lib/debug';
import bind from '../../lib/bind';
import {createBasename} from '../../lib/utils';
import { FileInfo } from '../../lib/fileinfo';

const s_saveDebounceDuration = 2000;
const s_folderVersion = 6;

type LocalFsAPI = {
  existsSync: (path: string) => boolean;
  readdir: (path: string, callback: (err: NodeJS.ErrnoException | null, files: string[]) => void) => void;
  readFileAsStringSync: (path: string) => string;
  unlinkSync: (path: string) => void;
  writeFileSync: (path: string, data: string | Buffer) => void;
};

// TODO: figure out a better way type this. Or use ajv or something?
const versionConverters: Record<string, (data: unknown, filepath: string) => unknown> = {};

export default class FolderData {
  _logger: Logger;
  _filepath: string;
  _fs: LocalFsAPI;
  _fileExists: boolean;
  _baseFilename: string;
  _jsonFilename: string;
  _data: {
    version: number;
    folderPath: string;
    files: Record<string, FileInfo>;
    scannedTime?: number;
  }
  _queueWrite: () => void;

  constructor(filepath: string, options: {
    fs: LocalFsAPI;
    dataDir: string;
    readOnly?: boolean;
  }) {
    this._logger = debug('FolderData', filepath);
    this._filepath = filepath;
    this._fs = options.fs;
    bind(
      this,
      '_save',
    );
    if (options.readOnly) {
      this._save = () => {};
    }
    this._fileExists = false;
    this._baseFilename = createBasename(options.dataDir, 'folder', this._filepath);
    this._jsonFilename = `${this._baseFilename}.json`;
    this._data = {
      version: s_folderVersion,
      folderPath: filepath,
      files: {},
    };
    this._queueWrite = _.debounce(this._save, s_saveDebounceDuration);  // save if we haven't added anything in 1 second
    this._logger('checking:', this._jsonFilename);
    if (this._fs.existsSync(this._jsonFilename)) {
      this._logger('read:', this._jsonFilename);
      try {
        const json = this._fs.readFileAsStringSync(this._jsonFilename);
        this._fileExists = true;
        let data = JSON.parse(json as string);
        while (data.version !== s_folderVersion) {
          const converter = versionConverters[data.version];
          if (!converter) {
            throw new Error('bad version');
          }
          data = converter(data, filepath);
          this._queueWrite();
        }
        this._data = data;
      } catch (e) {
        console.error('could not read:', this._jsonFilename, e);
        this._queueWrite();
      }
    }
  }
  get files() {
    return this._data.files;
  }
  get baseFilename() {
    return this._baseFilename;
  }
  get scannedTime() {
    return this._data.scannedTime;
  }
  get exists() {
    return this._fileExists;
  }
  deleteData() {
    if (this._fileExists) {
      // should I trap this?
      try {
        this._fs.unlinkSync(this._jsonFilename);
      } catch (e) {
        this._logger.error(e);
      }
    }
    this._save = () => {};
  }
  _save() {
    this._logger('writing:', this._jsonFilename);
    this._fs.writeFileSync(
      this._jsonFilename,
      JSON.stringify(this._data, null, 2),
    );
    this._fileExists = true;
  }
  addFiles(files: Record<string, FileInfo>) {
    let changed = false;
    for (const [filePath, fileInfo] of Object.entries(files)) {
      if (!_.isEqual(this._data.files[filePath], fileInfo)) {
        changed = true;
        this._data.files[filePath] = fileInfo;
      }
    }
    if (changed) {
      this._queueWrite();
    }
  }
  setScannedTime(time?: number) {
    this._data.scannedTime = time ?? Date.now();
    this._queueWrite();
  }
  removeFiles(filepaths: string[]) {
    let changed = false;
    for (const filepath of filepaths) {
      if (this._data.files[filepath]) {
        changed = true;
        delete this._data.files[filepath];
      }
    }
    if (changed) {
      this._queueWrite();
    }
  }
}
