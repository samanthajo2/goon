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
import _ from 'lodash';
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
  _logger: Logger
  _filename: string;
  _folderData: FolderData;
  _thumbnailPageMakerFn: ThumbnailPageMakerFn;
  _watcher: WatcherConsolidator;
  _fs: LocalFsAPI;
  _newFiles: FilesByPath | undefined;
  _isMakingThumbnails: boolean;
  _isChecking: boolean;
  _listenerManager: ListenerManager;
  constructor(filename: string, options: {
    folderData: FolderData,
    thumbnailPageMakerFn: ThumbnailPageMakerFn,
    watcher: WatcherConsolidator,
    fs: LocalFsAPI,
  }) {
    super();
    this._logger = debug('Folder', filename);
    this._logger('new folder');
    this._filename = filename;
    this._folderData = options.folderData;
    this._thumbnailPageMakerFn = options.thumbnailPageMakerFn;
    this._watcher = options.watcher;
    this._fs = options.fs;
    // if there are new files then we have work to do
    this._newFiles = undefined;
    this._isMakingThumbnails = false;
    // we always have a watcher which will call
    // _updateFiles after it has readdir this folder
    // so _isChecking tracks that state.
    this._isChecking = true;
    bind(
      this,
      '_updateFiles',
    );

    process.nextTick(() => {
      this._sendImagesAndVideos();
      const bins = separateFiles(this._folderData.files);
      this._sendFoldersAndArchives(bins);
    });

    this._listenerManager = new ListenerManager();
    const on = this._listenerManager.on.bind(this._listenerManager);
    on(this._watcher, 'files', this._updateFiles);
  }

  deleteData() {
    const files = this._folderData.files;
    const names = getSeparateFilenames(files);
    deleteThumbnails(this._fs, files);
    this._folderData.deleteData();
    return names;
  }

  close() {
    this._listenerManager.removeAll();
    this._watcher.close();
  }

  getSeparateFilenames() {
    return getSeparateFilenames(this._folderData.files);
  }

  refresh() {
    this._watcher.refresh();
  }

  get filename() {
    return this._filename;
  }

  async _updateThumbnails(oldImagesAndVideos: FilesByPath, newImagesAndVideos: FilesByPath) {
    this._logger('updateThumbnails');
    if (this._isMakingThumbnails) {
      throw new Error('already making thumbnails');
    }
    this._isMakingThumbnails = true;
    this._sendImagesAndVideos();
    try {
      const files = await this._thumbnailPageMakerFn(oldImagesAndVideos, newImagesAndVideos, this._folderData.baseFilename);
      this._logger('got thumbnails', files);
      this._folderData.addFiles(files);
    } catch (e) {
      console.warn(`could not make thumbnails for: ${this._filename}`, e);
    } finally {
      this._isMakingThumbnails = false;
      this._folderData.setScannedTime();
    }
    this._sendImagesAndVideos();
    this._processFiles();
  }

  _sendImagesAndVideos() {
    this.emit('updateFiles', this._filename, this.getData());
  }

  getData() {
    return {
      files: getImagesAndVideos(this._folderData.files),
      status: {
        scanning: this._isMakingThumbnails,
        checking: this._isChecking,
        scannedTime: this._folderData.scannedTime,
      },
    };
  }

  _addFiles(files: FilesByPath) {
    this._folderData.addFiles(files);
  }

  _removeFiles(filenames: string[]) {
    this._folderData.removeFiles(filenames);
  }

  // This is called by the watcher to give us ALL
  // the files and folders for this folder
  // @param {Object.<string, stat>} files
  _updateFiles(files: FilesByPath) {
    this._logger('updateFiles:', files);
    this._isChecking = false;
    this._sendImagesAndVideos();
    // first filter out everything we don't want
    this._newFiles = filterFiles(files);
    this._processFiles();
  }

  _processFiles() {
    if (this._isMakingThumbnails) {
      return;
    }
    if (!this._newFiles) {
      return;
    }
    const oldFiles = {...this._folderData.files};
    const newFiles = this._newFiles;
    this._newFiles = undefined;
    this._logger('processFiles:', newFiles);
    const oldBins = separateFiles(oldFiles);
    const newBins = separateFiles(newFiles);
    const diffNames = getDifferentFilenames(oldFiles, newFiles);
    this._removeFiles(diffNames.removed);
    // check if any data has changed
    if (!areFilesSame(oldFiles, newFiles)) {
      this._updateThumbnails(oldBins.imagesAndVideos, newBins.imagesAndVideos);
    }
    this._logger('emit updateFolders', this._filename);
    this._addFiles(newBins.folders);
    this._logger('emit updateArchives', this._filename);
    this._addFiles(newBins.archives);
    // we need to know which archives changed or were added
    const archiveFilenamesThatNeedUpdate = _.intersection(
      [...diffNames.changed, ...diffNames.added],
      Object.keys(newBins.archives),
    );
    this._sendFoldersAndArchives(newBins, archiveFilenamesThatNeedUpdate);
  }

  _sendFoldersAndArchives(bins: ReturnType<typeof separateFiles>, archiveFilenamesThatNeedUpdate: string[] = []) {
    this.emit('updateFolders', this._filename, bins.folders);
    this.emit('updateArchives', this._filename, bins.archives, archiveFilenamesThatNeedUpdate);
  }
}
