/*
Copyright 2024 SamanthaJo

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import path from 'node:path';
import EventEmitter from 'node:events';
import { throttle, arrayDifference, CancelableFn } from '../utils';
import bind from '../bind';
import debug from '../debug';
import ListenerManager from '../listener-manager';
import { removeChildFolders } from '../utils';
import TreeWatcher from './tree-watcher';

// Manages multiple Tree Watchers
//
// Tries to minimize the number of watchers
// meaning if you watch 'a/b/c', and 'a/b' then
// you really only need a watcher for 'a/b'
//
// Returns FolderWatchers which watch only a single
// folder

export class FolderWatcher extends EventEmitter {
  private _folderName: string;
  private _unwatchFn: (() => void) | undefined;
  private _logger: ReturnType<typeof debug>;
  private _started: boolean;

  constructor(folderName: string, unwatchFn: () => void) {
    super();
    this._logger = debug('FolderWatcher', folderName);
    this._folderName = folderName;
    this._unwatchFn = unwatchFn;
    this._started = false;
  }

  get folderName(): string {
    return this._folderName;
  }

  emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (eventName === 'start') {
      if (this._started) {
        return false;
      }
      this._started = true;
    }
    this._logger(String(eventName), ...args);
    return super.emit(eventName, ...args);
  }

  close(): void {
    if (this._unwatchFn) {
      const fn = this._unwatchFn;
      this._unwatchFn = undefined;
      fn();
    }
  }
}

class TreeWatcherDispatcher {
  private _logger: ReturnType<typeof debug>;
  private _listenerManager: ListenerManager;
  private _started: boolean;
  private _treeWatcher: TreeWatcher | null;
  private _folderWatchers: FolderWatcher[];
  private _emitStartEvent: CancelableFn;

  constructor(treeWatcher: TreeWatcher) {
    bind(this, '_startEventForwarder');
    this._emitStartEvent = throttle(this._doEmitStartEvent.bind(this), 0);
    this._logger = debug('TreeWatcherDispatcher', treeWatcher.folderPath);
    this._listenerManager = new ListenerManager();
    const on = this._listenerManager.on.bind(this._listenerManager);
    on(treeWatcher, 'start', this._startEventForwarder.bind(this));
    on(treeWatcher, 'create', this._makeEventForwarder('create'));
    on(treeWatcher, 'change', this._makeEventForwarder('change'));
    on(treeWatcher, 'remove', this._makeEventForwarder('remove'));
    this._started = false;
    this._treeWatcher = treeWatcher;
    this._folderWatchers = [];
  }

  get treeWatcher(): TreeWatcher | null {
    return this._treeWatcher;
  }

  close(): void {
    this._listenerManager.removeAll();
    this._treeWatcher = null;
  }

  addFolderWatchers(watchers: FolderWatcher[]): void {
    this._folderWatchers = this._folderWatchers.concat(watchers);
    if (this._started) {
      process.nextTick(() => this._emitStartEvent());
    }
  }

  removeAllWatchers(): void {
    this._folderWatchers = [];
  }

  private _startEventForwarder(): void {
    this._started = true;
    this._emitStartEvent();
  }

  private _doEmitStartEvent(): void {
    for (const folderWatcher of this._folderWatchers) {
      folderWatcher.emit('start');
    }
  }

  private _makeEventForwarder(eventName: string): (filepath: string, ...args: unknown[]) => void {
    return (filepath: string, ...args: unknown[]) => {
      this._logger(eventName, filepath);
      const folderName = path.dirname(filepath);
      for (const folderWatcher of this._folderWatchers) {
        if (folderWatcher.folderName === folderName) {
          this._logger('emit', eventName, filepath);
          folderWatcher.emit(eventName, filepath, ...args);
        }
      }
    };
  }
}

export default class WatcherManager {
  private _folderWatchersByPath: Record<string, FolderWatcher[]>;
  private _treeWatchersDispatcherByPath: Record<string, TreeWatcherDispatcher>;
  private _closed: boolean;

  constructor() {
    this._folderWatchersByPath = {};
    this._treeWatchersDispatcherByPath = {};
    this._closed = false;
  }

  async close(): Promise<void> {
    if (!this._closed) {
      this._closed = true;
      const promises: (Promise<void> | void)[] = [];
      for (const treeWatcherDispatcher of Object.values(this._treeWatchersDispatcherByPath)) {
        const treeWatcher = treeWatcherDispatcher.treeWatcher!;
        treeWatcherDispatcher.removeAllWatchers();
        treeWatcherDispatcher.close();
        promises.push(treeWatcher.close());
      }
      await Promise.all(promises);
      this._treeWatchersDispatcherByPath = {};
      this._folderWatchersByPath = {};
    }
  }

  watch(folderName: string): FolderWatcher | null {
    if (this._closed) {
      return null;
    }
    const folderWatcher = new FolderWatcher(folderName, () => {
      this._unwatch(folderWatcher);
    });
    let folderWatchersForPath = this._folderWatchersByPath[folderName];
    if (!folderWatchersForPath) {
      folderWatchersForPath = [];
      this._folderWatchersByPath[folderName] = folderWatchersForPath;
    }
    folderWatchersForPath.push(folderWatcher);
    this._shuffleFolderWatchers();
    return folderWatcher;
  }

  private _unwatch(folderWatcher: FolderWatcher): void {
    if (this._closed) {
      return;
    }
    const folderName = folderWatcher.folderName;
    const folderWatchersForPath = this._folderWatchersByPath[folderName];
    if (!folderWatchersForPath) {
      throw new Error('unknown watcher');
    }
    const ndx = folderWatchersForPath.indexOf(folderWatcher);
    if (ndx < 0) {
      throw new Error('unknown watcher');
    }
    folderWatchersForPath.splice(ndx, 1);
    if (folderWatchersForPath.length === 0) {
      delete this._folderWatchersByPath[folderName];
    }
    this._shuffleFolderWatchers();
  }

  private _shuffleFolderWatchers(): void {
    const treeWatcherPathsWeNeed = removeChildFolders(Object.keys(this._folderWatchersByPath));
    const treeWatcherPathsWeHave = Object.keys(this._treeWatchersDispatcherByPath);
    const treeWatcherPathsToRemove = arrayDifference(treeWatcherPathsWeHave, treeWatcherPathsWeNeed);
    const treeWatcherPathsToAdd = arrayDifference(treeWatcherPathsWeNeed, treeWatcherPathsWeHave);

    for (const treeWatcherDispatcher of Object.values(this._treeWatchersDispatcherByPath)) {
      treeWatcherDispatcher.removeAllWatchers();
    }

    for (const treeWatcherPath of treeWatcherPathsToRemove) {
      const treeWatcherDispatcher = this._treeWatchersDispatcherByPath[treeWatcherPath];
      const treeWatcher = treeWatcherDispatcher.treeWatcher!;
      treeWatcherDispatcher.close();
      treeWatcher.close();
      delete this._treeWatchersDispatcherByPath[treeWatcherPath];
    }

    for (const treeWatcherPath of treeWatcherPathsToAdd) {
      const treeWatcher = new TreeWatcher(treeWatcherPath);
      const treeWatcherDispatcher = new TreeWatcherDispatcher(treeWatcher);
      this._treeWatchersDispatcherByPath[treeWatcherPath] = treeWatcherDispatcher;
    }

    for (const [folderPath, folderWatchersForPath] of Object.entries(this._folderWatchersByPath)) {
      for (const treeWatcherPath of treeWatcherPathsWeNeed) {
        if (folderPath.startsWith(treeWatcherPath)) {
          this._treeWatchersDispatcherByPath[treeWatcherPath].addFolderWatchers(folderWatchersForPath);
          break;
        }
      }
    }
  }
}
