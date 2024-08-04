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

import EventEmitter from 'events';
import {performance} from '../../lib/perf';

// Emits:
//   pending: there is more data. Start processing
//   updateFiles: just like thumber
//
// Anytime `'pending'` arrives start calling `process`
// until it returns false.
export default class FolderFilter extends EventEmitter {
  constructor(processTimeMs = 5) {
    super();
    this._pendingFolders = [];
    this._filter = null;
    this._processTimeMs = processTimeMs;
    this._cancelHelper = {
      cancelled: false,
    };
  }
  updateFiles(folders) {
    for (const [folderName, folder] of Object.entries(folders)) {
      const ndx = this._pendingFolders.findIndex((pending) => pending.folderName === folderName);
      if (ndx >= 0) {
        this._pendingFolders.splice(ndx, 1);
      }
      this._pendingFolders.push({
        folderName,
        folder,
      });
    }
    process.nextTick(() => {
      this.emit('pending');
    });
  }
  setFilter(filter) {
    this._cancelHelper.cancelled = true;
    this._cancelHelper = {
      cancelled: false,
    };
    this._filter = filter;
    this._pendingFolders = [];
    this._currentFolder = undefined;
    this._currentFiles = undefined;
    this._currentFolderName = undefined;
    this._outFiles = {};
  }
  process() {
    const startTimeMs = performance.now();
    for (;;) {
      if (!this._currentFiles) {
        if (!this._pendingFolders.length) {
          return false;
        }
        const folderInfo = this._pendingFolders.shift();
        this._outFolder = {};
        this._currenFolder = folderInfo.folder;
        this._currentFolderName = folderInfo.folderName;
        this._currentFiles = Object.entries(folderInfo.folder.files);
      } else if (this._currentFiles.length) {
        const file = this._currentFiles.pop();
        const filename = file[0];
        const fileInfo = file[1];
        if (this._filter(filename, fileInfo)) {
          this._outFiles[filename] = fileInfo;
        }
      } else {
        const folder = this._currenFolder;
        const folderName = this._currentFolderName;
        const files = this._outFiles;
        this._currentFolder = undefined;
        this._currentFolderName = undefined;
        this._outFiles = {};
        this._currentFiles = undefined;
        this._sendFolder(folderName, {
          status: folder.status,
          files,
        });
      }
      const elapsedTimeMs = performance.now() - startTimeMs;
      if (elapsedTimeMs >= this._processTimeMs) {
        break;
      }
    }
    return true;
  }
  _sendFolder(folderName, folder) {
    const cancelHelper = this._cancelHelper;
    const folders = {};
    folders[folderName] = folder;

    // Should we emit immediately or wait?
    // Advantage to immediate is time to process
    // result is included in our time budget.
    // Advantage to wait is we don't have to
    // worry about event loops.
    process.nextTick(() => {
      if (!cancelHelper.cancelled) {
        this.emit('updateFiles', folders);
      }
    });
  }
}
