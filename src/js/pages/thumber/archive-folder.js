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
import debug from '../../lib/debug';
import {getImagesAndVideos, getSeparateFilenames, deleteThumbnails} from './folder-utils';

export default class ArchiveFolder extends EventEmitter {
  constructor(filename, options) {
    super();
    this._logger = debug('ArchiveFolder', filename);
    this._logger('new ArchiveFolder');
    this._filename = filename;
    this._folderData = options.folderData;
    this._fs = options.fs;
    this._thumbnailPageMakerFn = options.thumbnailPageMakerFn;
    try {
      const stat = this._fs.statSync(filename);
      const scannedTime = this._folderData.scannedTime;
      this._needUpdate = !scannedTime || stat.mtimeMs > scannedTime;
    }  catch (e) {
      console.error('failed to stat archive', filename);
      this._needUpdate = true;
    }
    this._isMakingThumbnails = false;

    process.nextTick(() => {
      this._sendImagesAndVideos();
      this._processArchive();
    });
  }

  get filename() {
    return this._filename;
  }

  deleteData() {
    const files = this._folderData.files;
    const names = getSeparateFilenames(files);
    deleteThumbnails(this._fs, this._folderData.files);
    this._folderData.deleteData();
    return names;
  }

  close() {
  }

  getSeparateFilenames() {
    return getSeparateFilenames(this._folderData.files);
  }

  async _updateThumbnails() {
    this._logger('updateThumbnails');
    if (this._isMakingThumbnails) {
      throw new Error('already making thumbnails');
    }
    this._isMakingThumbnails = true;
    this._sendImagesAndVideos();
    // remove all the files since we just got a new archive
    this._folderData.removeFiles(Object.keys(this._folderData.files));
    try {
      const baseFilename = this._folderData.baseFilename;
      const files = await this._thumbnailPageMakerFn(this._filename, baseFilename);
      this._logger('got thumbnails', files);
      this._folderData.addFiles(files);
    } catch (e) {
      console.warn(`could not make thumbnails for: ${this._filename}`, e);
    } finally {
      this._isMakingThumbnails = false;
      this._folderData.setScannedTime();
    }
    this._sendImagesAndVideos();
    this._processArchive();
  }

  _sendImagesAndVideos() {
    this.emit('updateFiles', this._filename, this.getData());
  }

  getData() {
    return {
      files: getImagesAndVideos(this._folderData.files),
      status: {
        scanning: this._isMakingThumbnails,
        scannedTime: this._folderData.scannedTime,
        archive: true,
      },
    };
  }

  _processArchive() {
    if (this._isMakingThumbnails) {
      return;
    }
    if (!this._needUpdate) {
      return;
    }
    this._needUpdate = false;
    this._updateThumbnails();
  }

  refresh() {
    this.update();
  }

  update() {
    if (!this._needUpdate) {
      this._needUpdate = true;
      this._processArchive();
    }
  }
}
