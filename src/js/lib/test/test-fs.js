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

import temp from 'temp';  // eslint-disable-line
import fs from 'fs';
import path from 'path';
import debug from '../debug';
import * as testCleanup from './test-cleanup';

// we can add other functions later
export default class TestFS {
  constructor(_fs) {
    this._fs = _fs || fs;
    this._baseFilename = path.normalize(path.resolve(temp.path()));
    this._logger = debug('TestFS', this._baseFilename);
    this._files = {};
    this._folders = {};

    const api = {
      _files: [ 'writeFile', 'writeFileSync', ],
      _folders: [ 'mkdir', 'mkdirSync', ],
    };
    for (const [type, funcNames] of Object.entries(api)) {
      for (const funcName of funcNames) {
        this[funcName] = this._makeWrapper(type, funcName);
      }
    }
    for (const key in this._fs) {
      if (!this[key]) {
        const val = this._fs[key];
        if (typeof val === 'function') {
          this[key] = val.bind(this._fs);
        } else {
          this[key] = val;
        }
      }
    }

    this._fs.mkdirSync(this._baseFilename);
    this.close = this.close.bind(this);
    testCleanup.register(this.close);
  }
  get baseFilename() {
    return this._baseFilename;
  }
  _isChild(filename) {
    // NOTE: this check is case sensitive so it won't handle the case if
    // baseFilename has a different case BUT it's unlikely users will manipulate
    // paths below that so?!???
    return path.normalize(path.resolve(filename)).startsWith(this._baseFilename);
  }
  _makeWrapper(type, funcName) {
    return (filename, ...args) => {
      if (this._isChild(filename)) {
        this._logger(funcName, filename);
        this[type][filename] = true;
      }
      return this._fs[funcName].call(this._fs, filename, ...args);
    };
  }
  close() {
    if (this._fs) {
      testCleanup.unregister(this.close);
      for (const filename of Object.keys(this._files)) {
        try {
          this._fs.unlinkSync(filename);
        } catch (e) {
          //
        }
      }
      for (const filename of Object.keys(this._folders)) {
        try {
          this._fs.rmdirSync(filename);
        } catch (e) {
          //
        }
      }
      this._fs.rmdirSync(this._baseFilename);
      this._fs = undefined;
    }
  }
}
