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

import EventEmitter from 'node:events';
import debug, { Logger } from '../../lib/debug';
import {getImagesAndVideos, getSeparateFilenames, deleteThumbnails} from './folder-utils';
import FolderData from './folder-data';
import { FilesByPath } from '../../lib/fileinfo';
import type { BaseFolder } from './base-folder';

type LocalFsAPI = {
  unlinkSync: (filename: string) => void;
  statSync: (filename: string) => { mtimeMs: number };
};

type ArchiveThumbnailMakerFn = (filepath: string, baseFilename: string) => Promise<FilesByPath>;

export default class ArchiveFolder extends EventEmitter implements BaseFolder {
  emit(event: 'updateFiles', filename: string, data: ReturnType<ArchiveFolder['getData']>): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(event: string, ...args: any[]): boolean { return super.emit(event, ...args); }

  on(event: 'updateFiles', fn: (filename: string, data: ReturnType<ArchiveFolder['getData']>) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, fn: (...args: any[]) => void): this { return super.on(event, fn); }
  #logger: Logger
  #filename: string;
  #folderData: FolderData;
  #thumbnailPageMakerFn: ArchiveThumbnailMakerFn;
  #fs: LocalFsAPI;
  #isMakingThumbnails: boolean;
  #needUpdate: boolean;

  constructor(
    filename: string,
    options: {
      folderData: FolderData;
      fs: LocalFsAPI;
      thumbnailPageMakerFn: ArchiveThumbnailMakerFn,
    },
  ) {
    super();
    this.#logger = debug('ArchiveFolder', filename);
    this.#logger('new ArchiveFolder');
    this.#filename = filename;
    this.#folderData = options.folderData;
    this.#fs = options.fs;
    this.#thumbnailPageMakerFn = options.thumbnailPageMakerFn;
    try {
      const stat = this.#fs.statSync(filename);
      const scannedTime = this.#folderData.scannedTime;
      this.#needUpdate = !scannedTime || stat.mtimeMs > scannedTime;
    }  catch {
      console.error('failed to stat archive', filename);
      this.#needUpdate = true;
    }
    this.#isMakingThumbnails = false;

    process.nextTick(() => {
      this.#sendImagesAndVideos();
      this.#processArchive();
    });
  }

  get filename() {
    return this.#filename;
  }

  deleteData() {
    const files = this.#folderData.files;
    const names = getSeparateFilenames(files);
    deleteThumbnails(this.#fs, this.#folderData.files);
    this.#folderData.deleteData();
    return names;
  }

  close() {
  }

  getSeparateFilenames() {
    return getSeparateFilenames(this.#folderData.files);
  }

  async #updateThumbnails() {
    this.#logger('updateThumbnails');
    if (this.#isMakingThumbnails) {
      throw new Error('already making thumbnails');
    }
    // Record time before scanning so any modification during the scan
    // (mtime > scanStartTime) will trigger a re-scan on next startup.
    const scanStartTime = Date.now();
    this.#isMakingThumbnails = true;
    this.#sendImagesAndVideos();
    // remove all the files since we just got a new archive
    this.#folderData.removeFiles(Object.keys(this.#folderData.files));
    try {
      const baseFilename = this.#folderData.baseFilename;
      const files = await this.#thumbnailPageMakerFn(this.#filename, baseFilename);
      this.#logger('got thumbnails', files);
      this.#folderData.addFiles(files);
    } catch (e) {
      console.warn(`could not make thumbnails for: ${this.#filename}`, e);
    } finally {
      this.#isMakingThumbnails = false;
      this.#folderData.setScannedTime(scanStartTime);
    }
    this.#sendImagesAndVideos();
    this.#processArchive();
  }

  #sendImagesAndVideos() {
    this.emit('updateFiles', this.#filename, this.getData());
  }

  getData() {
    return {
      files: getImagesAndVideos(this.#folderData.files),
      status: {
        scanning: this.#isMakingThumbnails,
        scannedTime: this.#folderData.scannedTime,
        archive: true,
      },
    };
  }

  #processArchive() {
    if (this.#isMakingThumbnails) {
      return;
    }
    if (!this.#needUpdate) {
      return;
    }
    this.#needUpdate = false;
    this.#updateThumbnails();
  }

  refresh() {
    this.update();
  }

  update() {
    if (!this.#needUpdate) {
      this.#needUpdate = true;
      this.#processArchive();
    }
  }
}
