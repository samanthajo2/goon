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
import debug, { Logger } from '../../lib/debug';
import SimpleFolderWatcher from '../../lib/simple-folder-watcher';
import ListenerManager from '../../lib/listener-manager';
import { FolderWatcherInterface } from '../../lib/watcher/folder-watcher';

const s_sendDebounceDuration = 1000;

function statToFileInfo(stat: { size: number; mtimeMs: number; isDirectory: () => boolean } ) {
  return {
    size: stat.size,
    mtime: stat.mtimeMs,
    isDirectory: stat.isDirectory(),
  };
}

type LocalFsAPI = {
  readdir: (path: string, callback: (err: Error | null, files: string[]) => void) => void;
  stat: (path: string, callback: (err: Error | null, stats: { size: number; mtimeMs: number; isDirectory: () => boolean }) => void) => void;
};

// Wrapper SimpleFolderWatcher. emits ALL files
export default class WatcherConsolidator extends EventEmitter {
  #logger: Logger;
  #files: Record<string, { size: number; mtime: number; isDirectory: boolean }>;
  #queueSend: () => void;
  #listenerManager: ListenerManager;
  #watcher: SimpleFolderWatcher;

  constructor(filepath: string, watcherFactory: (filePath: string) => FolderWatcherInterface | null, fs: LocalFsAPI, options?: {
    cachedDirMtime?: number;
    initialEntries?: Map<string, { size: number; mtimeMs: number; isDirectory: boolean }>;
    onDirMtime?: (mtime: number) => void;
  }) {
    super();
    this.#logger = debug('WatcherConsolidator', filepath);
    this.#watcher = new SimpleFolderWatcher(filepath, {
      watcherFactory,
      fs,
      cachedDirMtime: options?.cachedDirMtime,
      initialEntries: options?.initialEntries,
      onDirMtime: options?.onDirMtime,
    });
    bind(
      this,
      '_addFile',
      '_changeFile',
      '_removeFile',
      '_end',
      '_send',
      '_error',
    );
    this.#queueSend = function noop() {};
    this.#files = {};
    this.#listenerManager = new ListenerManager();
    const on = this.#listenerManager.on.bind(this.#listenerManager);
    on(this.#watcher, 'add', this._addFile);
    on(this.#watcher, 'create', this._addFile);
    on(this.#watcher, 'change', this._changeFile);
    on(this.#watcher, 'remove', this._removeFile);
    on(this.#watcher, 'end', this._end);
    on(this.#watcher, 'error', this._error);
  }
  close() {
    this.#listenerManager.removeAll();
    this.#watcher.close();
  }
  refresh() {
    this.#watcher.refresh();
  }
  _send() {
    this.emit('files', this.#files);
  }
  _addFile(filePath: string, stat: { size: number; mtimeMs: number; isDirectory: () => boolean }) {
    this.#logger('addFile:', filePath);
    this.#files[filePath] = statToFileInfo(stat);
    this.#queueSend();
  }
  _changeFile(filePath: string, stat: { size: number; mtimeMs: number; isDirectory: () => boolean }) {
    this.#logger('changeFile:', filePath);
    this.#files[filePath] = statToFileInfo(stat);
    this.#queueSend();
  }
  _removeFile(filePath: string /* , stat */) {
    this.#logger('removeFile:', filePath);
    delete this.#files[filePath];
    this.#queueSend();
  }
  _end() {
    this.#logger('end');
    this._send();
    this.#queueSend = _.throttle(this._send, s_sendDebounceDuration);  // send if we haven't added anyhting in 1 second
  }
  _error() {
    // does this matter?
    this._end();  // send. If we got an error on start this will mean no files which seems like what we want.
  }
}
