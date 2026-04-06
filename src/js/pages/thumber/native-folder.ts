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
import { arrayIntersection } from '../../lib/utils';
import bind from '../../lib/bind';
import * as filters from '../../lib/filters';
import debug, { Logger } from '../../lib/debug';
import ListenerManager from '../../lib/listener-manager';
import {areFilesSame, getDifferentFilenames} from '../../lib/utils';
import {
  getImagesAndVideos,
  getSeparateFilenames,
  deleteThumbnails,
  separateFiles,
} from './folder-utils';
import { FilesByPath } from '../../lib/fileinfo';
import { ThumbnailPageMakerFn } from './folder-thumbnail-maker';
import FolderData from './folder-data';
import WatcherConsolidator from './watcher-consolidator';

function filterFiles(files: FilesByPath) {
  const filteredFiles: FilesByPath = {};
  Object.keys(files)
    .filter(
      (filename) => files[filename].isDirectory ||
      filters.isArchive(filename) ||
      filters.isMediaExtension(filename)
    )
    .forEach((filename) => {
      filteredFiles[filename] = files[filename];
    });
  return filteredFiles;
}

type LocalFsAPI = {
  unlinkSync: (filename: string) => void;
};


// Represents one Folder of thumbnails
export default class NativeFolder extends EventEmitter {
  #logger: Logger
  #filename: string;
  #folderData: FolderData;
  #thumbnailPageMakerFn: ThumbnailPageMakerFn;
  #watcher: WatcherConsolidator;
  #fs: LocalFsAPI;
  #newFiles: FilesByPath | undefined;
  #isMakingThumbnails: boolean;
  #isChecking: boolean;
  #listenerManager: ListenerManager;
  constructor(filename: string, options: {
    folderData: FolderData,
    thumbnailPageMakerFn: ThumbnailPageMakerFn,
    watcher: WatcherConsolidator,
    fs: LocalFsAPI,
  }) {
    super();
    this.#logger = debug('Folder', filename);
    this.#logger('new folder');
    this.#filename = filename;
    this.#folderData = options.folderData;
    this.#thumbnailPageMakerFn = options.thumbnailPageMakerFn;
    this.#watcher = options.watcher;
    this.#fs = options.fs;
    // if there are new files then we have work to do
    this.#newFiles = undefined;
    this.#isMakingThumbnails = false;
    // we always have a watcher which will call
    // _updateFiles after it has readdir this folder
    // so _isChecking tracks that state.
    this.#isChecking = true;
    bind(
      this,
      '_updateFiles',
    );

    process.nextTick(() => {
      this._sendImagesAndVideos();
      const bins = separateFiles(this.#folderData.files);
      this._sendFoldersAndArchives(bins);
    });

    this.#listenerManager = new ListenerManager();
    const on = this.#listenerManager.on.bind(this.#listenerManager);
    on(this.#watcher, 'files', this._updateFiles);
  }

  deleteData() {
    const files = this.#folderData.files;
    const names = getSeparateFilenames(files);
    deleteThumbnails(this.#fs, files);
    this.#folderData.deleteData();
    return names;
  }

  close() {
    this.#listenerManager.removeAll();
    this.#watcher.close();
  }

  getSeparateFilenames() {
    return getSeparateFilenames(this.#folderData.files);
  }

  refresh() {
    this.#watcher.refresh();
  }

  get filename() {
    return this.#filename;
  }

  async _updateThumbnails(oldImagesAndVideos: FilesByPath, newImagesAndVideos: FilesByPath) {
    this.#logger('updateThumbnails');
    if (this.#isMakingThumbnails) {
      throw new Error('already making thumbnails');
    }
    this.#isMakingThumbnails = true;
    this._sendImagesAndVideos();
    try {
      const files = await this.#thumbnailPageMakerFn(oldImagesAndVideos, newImagesAndVideos, this.#folderData.baseFilename);
      this.#logger('got thumbnails', files);
      this.#folderData.addFiles(files);
    } catch (e) {
      console.warn(`could not make thumbnails for: ${this.#filename}`, e);
    } finally {
      this.#isMakingThumbnails = false;
      this.#folderData.setScannedTime();
    }
    this._sendImagesAndVideos();
    this._processFiles();
  }

  _sendImagesAndVideos() {
    this.emit('updateFiles', this.#filename, this.getData());
  }

  getData() {
    return {
      files: getImagesAndVideos(this.#folderData.files),
      status: {
        scanning: this.#isMakingThumbnails,
        checking: this.#isChecking,
        scannedTime: this.#folderData.scannedTime,
      },
    };
  }

  _addFiles(files: FilesByPath) {
    this.#folderData.addFiles(files);
  }

  _removeFiles(filenames: string[]) {
    this.#folderData.removeFiles(filenames);
  }

  // Proactively remove a single file and notify listeners without waiting
  // for a filesystem watcher event. Used when trashing a file so the thumbnail
  // disappears immediately even if chokidar doesn't fire (e.g. network drives).
  removeFileAndNotify(filePath: string) {
    this._removeFiles([filePath]);
    this._sendImagesAndVideos();
  }

  // This is called by the watcher to give us ALL
  // the files and folders for this folder
  // @param {Object.<string, stat>} files
  _updateFiles(files: FilesByPath) {
    this.#logger('updateFiles:', files);
    this.#isChecking = false;
    this._sendImagesAndVideos();
    // first filter out everything we don't want
    this.#newFiles = filterFiles(files);
    this._processFiles();
  }

  _processFiles() {
    if (this.#isMakingThumbnails) {
      return;
    }
    if (!this.#newFiles) {
      return;
    }
    const oldFiles = {...this.#folderData.files};
    const newFiles = this.#newFiles;
    this.#newFiles = undefined;
    this.#logger('processFiles:', newFiles);
    const oldBins = separateFiles(oldFiles);
    const newBins = separateFiles(newFiles);
    const diffNames = getDifferentFilenames(oldFiles, newFiles);
    this._removeFiles(diffNames.removed);
    // check if any data has changed
    if (!areFilesSame(oldFiles, newFiles)) {
      this._updateThumbnails(oldBins.imagesAndVideos, newBins.imagesAndVideos);
    }
    this.#logger('emit updateFolders', this.#filename);
    this._addFiles(newBins.folders);
    this.#logger('emit updateArchives', this.#filename);
    this._addFiles(newBins.archives);
    // we need to know which archives changed or were added
    const archiveFilenamesThatNeedUpdate = arrayIntersection(
      [...diffNames.changed, ...diffNames.added],
      Object.keys(newBins.archives),
    );
    this._sendFoldersAndArchives(newBins, archiveFilenamesThatNeedUpdate);
  }

  _sendFoldersAndArchives(bins: ReturnType<typeof separateFiles>, archiveFilenamesThatNeedUpdate: string[] = []) {
    this.emit('updateFolders', this.#filename, bins.folders);
    this.emit('updateArchives', this.#filename, bins.archives, archiveFilenamesThatNeedUpdate);
  }
}
