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
import _ from 'lodash';
import path from 'path';
import { FileInfo, FilesByPath } from '../../lib/fileinfo';
import { FolderInfo, FoldersByPath } from '../../lib/folderinfo';

type DisplayFileInfo = FileInfo & {
    baseName: string;
    folderName: string;
    lowercaseName: string;
};

type DisplayFilesByPath = { [key: string]: DisplayFileInfo };
type DisplayFolderInfo = Omit<FolderInfo, 'files'> & {
  files: DisplayFilesByPath;
};
type DisplayFoldersByPath = { [key: string]: DisplayFolderInfo };

function addFileMetaData(files: FilesByPath): DisplayFilesByPath {
  return Object.fromEntries(Object.entries(files).map(([filename, fileInfo]) => {
    return [
      filename,
      {
        ...fileInfo,
        baseName: path.basename(filename).toLowerCase(),
        folderName: path.dirname(filename).toLowerCase(),
        lowercaseName: fileInfo.displayName.toLowerCase(),
      },
    ];
  })) as DisplayFilesByPath;
}

function folderInfoToDisplayFolderInfo(folder: FolderInfo): DisplayFolderInfo {
  return {
    ...folder,
    files: addFileMetaData(folder.files),
  };
}

// This is basically just a receptacle for all the data
// from the Thumber. We don't really need this. We
// could just ask the Thumber to send all the data again
// but for some reason it seems since to store the data
// locally.
export default class FolderDB extends EventEmitter {

  _folders: DisplayFoldersByPath;
  _newFolders: FoldersByPath;
  _totalFiles: number;

  constructor() {
    super();
    this._folders = {};
    this._totalFiles = 0;
    this._newFolders = {};
    this._processNewFolders = _.throttle(this._processNewFolders.bind(this), 1500);
  }
  get totalFiles() {
    return this._totalFiles;
  }

  updateFiles(folders: FoldersByPath) {
    Object.assign(this._newFolders, folders);
    this._processNewFolders();
  }

  _processNewFolders() {
    const folders = this._newFolders;
    this._newFolders = {};
    for (const [folderName, srcFolder] of Object.entries(folders)) {
      const folder = folderInfoToDisplayFolderInfo(srcFolder);
      folder.files = folder.files || {};
      folder.status = folder.status || {};
      const status = folder.status;
      const oldFolder = this._folders[folderName];
      if (oldFolder) {
        this._totalFiles -= Object.keys(oldFolder.files).length;
      }
      if (_.isEmpty(folder.files) && !status.scanning && !status.checking) {
        delete this._folders[folderName];
      } else {
        this._folders[folderName] = folder;
      }
      this._totalFiles += Object.keys(folder.files).length;
    }
    this.emit('updateFiles', folders);
  }
  sendAll() {
    process.nextTick(() => {
      this.emit('updateFiles', this._folders);
    });
  }
  getAllChildren(parentFolderName: string) {
    const children = [];
    for (const [folderName, folder] of Object.entries(this._folders)) {
      if (folderName.startsWith(parentFolderName)) {
        if (folderName !== parentFolderName) {
          children.push(folderName);
        }
        children.push(...Object.keys(folder.files));
      }
    }
    return children;
  }
}
