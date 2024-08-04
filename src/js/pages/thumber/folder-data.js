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
import debug from '../../lib/debug';
import bind from '../../lib/bind';
import {createBasename} from '../../lib/utils';

const s_saveDebounceDuration = 2000;
const s_folderVersion = 6;

function assert(cond, ...msg) {
  if (!cond) {
    throw new Error([...msg].join(' '));
  }
}

function convertVersion1To2OrThrow(data) {
  assert(data.version === 1);
  // only bad if archive data
  for (const fileInfo of Object.values(data.files)) {
    if (fileInfo.archiveName) {
      throw new Error('archives need new data from version 1');
    }
  }
  return {...data, version: 2};
}

function convertVersion2To3OrThrow(data) {
  assert(data.version === 2);
  // only bad if archive data
  for (const fileInfo of Object.values(data.files)) {
    if (fileInfo.thumbnail) {
      Object.assign(fileInfo.thumbnail, {
        pageSize: 2048,
      });
    }
  }
  return {...data, version: 3};
}

function convertVersion3To4OrThrow(data) {
  assert(data.version === 3);
  // only bad thumbnail.height < 1
  for (const fileInfo of Object.values(data.files)) {
    if (fileInfo.thumbnail && !(fileInfo.thumbnail.height > 0)) {
      throw new Error('bad thumbnail');
    }
  }
  return {...data, version: 4};
}

function convertVersion4To5OrThrow(data, folderPath) {
  assert(data.version === 4);
  data.folderPath = folderPath;
  return {...data, version: 5};
}

function convertVersion5To6OrThrow(data) {
  assert(data.version === 5);
  if (!data.scannedTime) {
    data.scannedTime = Date.now();
  }
  return {...data, version: 6};
}

const versionConverters = {
  '1': convertVersion1To2OrThrow,
  '2': convertVersion2To3OrThrow,
  '3': convertVersion3To4OrThrow,
  '4': convertVersion4To5OrThrow,
  '5': convertVersion5To6OrThrow,
};

export default class FolderData {
  constructor(filepath, options) {
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
    this._queueWrite = _.debounce(this._save, s_saveDebounceDuration);  // save if we haven't added anyhting in 1 second
    this._logger('checking:', this._jsonFilename);
    if (this._fs.existsSync(this._jsonFilename)) {
      this._logger('read:', this._jsonFilename);
      try {
        const json = this._fs.readFileSync(this._jsonFilename, {encoding: 'utf8'});
        this._fileExists = true;
        let data = JSON.parse(json);
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
      'utf8',
    );
    this._fileExists = true;
  }
  addFiles(files) {
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
  setScannedTime() {
    this._data.scannedTime = Date.now();
    this._queueWrite();
  }
  removeFiles(filepaths) {
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
