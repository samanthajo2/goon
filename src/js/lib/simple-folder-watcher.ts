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
import path from 'node:path';
import ListenerManager from './listener-manager';
import debug, { Logger } from './debug';
import bind from './bind';
import ResettableTimeout from './resettable-timeout';
import { FolderWatcherInterface } from './watcher/folder-watcher';

type Stats = {
  size: number;
  mtimeMs: number;
};

type LocalFsAPI = {
  readdir: (path: string, callback: (err: Error | null, files: string[]) => void) => void;
  stat: (path: string, callback: (err: Error | null, stats: Stats) => void) => void;
};

// Should I add option to normalize path (as in always '/' never '\'?
export default class SimpleFolderWatcher extends EventEmitter {
  _logger: Logger;
  _filePath: string;
  _fs: LocalFsAPI;
  _entries?: Map<string, Stats>;
  _listenerManager: ListenerManager;
  _closed: boolean;
  _scanning: boolean;
  _filter: (filepath: string) => boolean;
  _watcher?: FolderWatcherInterface | null;
  _timeout?: ResettableTimeout;
  _options: {
    filter?: (filepath: string) => boolean;
    watcherFactory: (filePath: string) => FolderWatcherInterface | null;
    addOrCreate?: 'add' | 'create';
    cachedDirMtime?: number;
    initialEntries?: Map<string, { size: number; mtimeMs: number; isDirectory: boolean }>;
    onDirMtime?: (mtime: number) => void;
  }

  constructor(
    filePath: string,
    options: {
      fs: LocalFsAPI;
      filter?: (filepath: string) => boolean;
      watcherFactory: (filePath: string) => FolderWatcherInterface | null;
      addOrCreate?: 'add' | 'create';
      cachedDirMtime?: number;
      initialEntries?: Map<string, { size: number; mtimeMs: number; isDirectory: boolean }>;
      onDirMtime?: (mtime: number) => void;
    },
  ) {
    super();
    bind(
      this,
      '_handleCreate',
      '_handleChange',
      '_handleRemove',
      '_handleError',
      '_sendEnd',
      '_sendEndAfterTimeout',
    );
    const opt = {...(options ?? {})};
    opt.addOrCreate = opt.addOrCreate ?? 'add';
    this._fs = opt.fs;
    this._logger = debug('SimpleFolderWatcher', filePath);
    this._entries = new Map();
    this._filePath = filePath;
    this._options = opt;
    this._filter = opt.filter ?? this._pass;
    this._closed = false;
    this._scanning = false;
    this._listenerManager = new ListenerManager();

    process.nextTick(() => {
      this._start(opt.watcherFactory);
    });
  }

  close() {
    if (this._closed) {
      return;
    }
    this._listenerManager.removeAll();
    this._watcher?.close();
    this._watcher = undefined;
    // I hope there's no queued events.
    this._entries = undefined;
    this._closed = true;
  }

  refresh() {
    if (!this._closed) {
      this._scan('create');
    }
  }

  _start(watcherFactory: (filePath: string) => FolderWatcherInterface | null) {
    // because this is async we might be closed before this fires
    if (this._closed) {
      return;
    }
    this._watcher = watcherFactory(this._filePath);
    if (!this._watcher) {
      return;
    }
    const on = this._listenerManager.on.bind(this._listenerManager);
    on(this._watcher, 'create', this._handleCreate);
    on(this._watcher, 'change', this._handleChange);
    on(this._watcher, 'remove', this._handleRemove);
    on(this._watcher, 'error', this._handleError);
    this._scan(this._options.addOrCreate ?? 'add');
  }

  _handleChange(filepath: string) {
    this._onChange('change', path.basename(filepath));
  }

  _handleCreate(filepath: string) {
    this._onChange('create', path.basename(filepath));
  }

  _handleRemove(filepath: string) {
    this._onChange('remove', path.basename(filepath));
  }

  _sendEnd() {
    this._logger('end');
    this.emit('end');
  }

  _sendEndAfterTimeout() {
    this._timeout = this._timeout ?? new ResettableTimeout(this._sendEnd, 250);
    this._timeout.reset();
  }

  _onChange(event: string, filename: string) {
    this._logger('ONCHANGE:', event, filename);
    this._checkFile(filename, undefined, this._sendEndAfterTimeout);
  }

  // TODO add this back in?
  _handleError(err: NodeJS.ErrnoException) {
    this._logger('ONERROR:', this._filePath);
    // not really sure what errors to check for here
    if (err && err.code === 'EPERM') {
      this._removeAll();
    } else {
      throw err;
    }
  }

  _scan(addOrCreate: 'add' | 'create') {
    if (this._scanning) {
      return;
    }
    this._scanning = true;
    const { cachedDirMtime, initialEntries, onDirMtime } = this._options;
    this._fs.stat(this._filePath, (statErr, dirStats) => {
      if (this._closed) {
        this._scanning = false;
        return;
      }
      // Fast path: directory mtime unchanged — use cached entries, skip readdir + per-file stats
      if (!statErr &&
          cachedDirMtime !== undefined &&
          dirStats.mtimeMs === cachedDirMtime &&
          initialEntries) {
        this._scanning = false;
        initialEntries.forEach((entryInfo, fileName) => {
          if (this._closed) {
            return;
          }
          const fullPath = path.join(this._filePath, fileName);
          if (!this._filter(fullPath)) {
            return;
          }
          const fakeStat = {
            size: entryInfo.size,
            mtimeMs: entryInfo.mtimeMs,
            isDirectory: () => entryInfo.isDirectory,
          };
          this._entries?.set(fileName, { size: entryInfo.size, mtimeMs: entryInfo.mtimeMs });
          this.emit(addOrCreate, fullPath, fakeStat);
        });
        this._sendEnd();
        return;
      }
      // Slow path: full readdir + per-file stat
      // Save the dir mtime so we can persist it after the scan completes
      const currentDirMtime = statErr ? undefined : dirStats.mtimeMs;
      this._fs.readdir(this._filePath, (err, fileNames) => {
        this._scanning = false;
        // because this is async we might be closed when this fires
        if (this._closed) {
          return;
        }
        if (err) {
          this.emit('error', `error ${err}: ${this._filePath}`);
        } else {
          const validFileNames = fileNames.filter((fileName) => this._filter(path.join(this._filePath, fileName)));
          // Check removed
          this._entries?.forEach((state, entryPath) => {
            if (validFileNames.indexOf(entryPath) < 0) {
              this._entries?.delete(entryPath);
              this.emit('remove', path.join(this._filePath, entryPath), state);
            }
          });

          let numToComplete = validFileNames.length + 1;
          const sendEndIfFinished = () => {
            --numToComplete;
            if (numToComplete === 0) {
              // Persist dir mtime only after a successful full scan
              if (currentDirMtime !== undefined && onDirMtime) {
                onDirMtime(currentDirMtime);
              }
              this._sendEnd();
            }
          };
          validFileNames.forEach((fileName) => {
            this._checkFile(fileName, addOrCreate, sendEndIfFinished);
          });
          sendEndIfFinished();
        }
      });
    });
  }

  _checkFile(fileName: string, addOrCreate = 'create', callback = (_: boolean) => {}) {
    this._logger('_checkFile', fileName);
    // how am I getting here if this is done? Looks like I'm getting notification for self.?
    if (this._closed) {
      this._logger('_checkFile called after closed!??!');
      callback(true);
      return;
    }
    const fullPath = path.join(this._filePath, fileName);
    if (!this._filter(fullPath)) {
      this._logger('filtered out:', fullPath);
      callback(true);
      return;
    }
    this._fs.stat(fullPath, (err, stats) => {
      // Because this is async we might be closed when this gets back
      if (this._closed) {
        callback(true);
        return;
      }
      const oldStats = this._entries?.get(fileName);
      if (err) {
        // TODO: check for type of error?
        if (oldStats) {
          this._entries?.delete(fileName);
          this._logger('emit remove:', fullPath);
          this.emit('remove', fullPath, oldStats);
        }
        callback(true);
      } else {
        this._entries?.set(fileName, stats);
        if (oldStats) {
          if (oldStats.size !== stats.size ||
              oldStats.mtimeMs !== stats.mtimeMs) {
            this._logger('emit change:', fullPath);
            this.emit('change', fullPath, stats, oldStats);
          }
        } else {
          this._logger('emit', addOrCreate, ':', fullPath);
          this.emit(addOrCreate, fullPath, stats);
        }
        callback(false);
      }
    });
  }

  _removeAll() {
    this._logger('REMOVEALL:', this._filePath);
    if (this._closed) {
      return;
    }
    this._entries?.forEach((stats, fileName) => {
      this.emit('remove', path.join(this._filePath, fileName), stats);
    });
    this._sendEnd();
    this.close();
  }

  _pass() {
    return true;
  }
}

