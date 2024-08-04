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

import bind from '../../lib/bind';
import debug from '../../lib/debug';
import SimpleFolderWatcher from '../../lib/simple-folder-watcher';
import ListenerManager from '../../lib/listener-manager';

const s_sendDebounceDuration = 1000;

function statToFileInfo(stat) {
  return {
    size: stat.size,
    mtime: stat.mtimeMs,
    isDirectory: stat.isDirectory(),
  };
}

// Wrapper SimpleFolderWatcher. emits ALL files
export default class WatcherConsolidator extends EventEmitter {
  constructor(filepath, watcherFactory, fs) {
    super();
    this._filepath = filepath;
    this._logger = debug('WatcherConsolidator', filepath);
    this._watcher = new SimpleFolderWatcher(filepath, {
      watcherFactory: watcherFactory,
      fs: fs,
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
    this._queueSend = function noop() {};
    this._files = {};
    this._listenerManager = new ListenerManager();
    const on = this._listenerManager.on.bind(this._listenerManager);
    on(this._watcher, 'add', this._addFile);
    on(this._watcher, 'create', this._addFile);
    on(this._watcher, 'change', this._changeFile);
    on(this._watcher, 'remove', this._removeFile);
    on(this._watcher, 'end', this._end);
    on(this._watcher, 'error', this._error);
  }
  close() {
    this._listenerManager.removeAll();
    this._watcher.close();
  }
  refresh() {
    this._watcher.refresh();
  }
  _send() {
    this.emit('files', this._files);
  }
  _addFile(filePath, stat) {
    this._logger('addFile:', filePath);
    this._files[filePath] = statToFileInfo(stat);
    this._queueSend();
  }
  _changeFile(filePath, stat) {
    this._logger('changeFile:', filePath);
    this._files[filePath] = statToFileInfo(stat);
    this._queueSend();
  }
  _removeFile(filePath /* , stat */) {
    this._logger('removeFile:', filePath);
    delete this._files[filePath];
    this._queueSend();
  }
  _end() {
    this._logger('end');
    this._send();
    this._queueSend = _.throttle(this._send, s_sendDebounceDuration);  // send if we haven't added anyhting in 1 second
  }
  _error() {
    // does this matter?
    this._end();  // send. If we got an error on start this will mean no files which seems like what we want.
  }
}
