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

import path from 'path';
import EventEmitter from 'events';
import _ from 'lodash';
import bind from '../bind';
import debug from '../debug';
import ListenerManager from '../listener-manager';
import {removeChildFolders} from '../utils';
import TreeWatcher from './tree-watcher';

// Manages multiple Tree Watchers
//
// Tries to minimize the number of watchers
// meaning if you watch 'a/b/c', and 'a/b' then
// you really only need a watcher for 'a/b'
//
// Returns FolderWatchers which watch only a single
// folder

class FolderWatcher extends EventEmitter {
  constructor(folderName, unwatchFn) {
    super();
    this._logger = debug('FolderWatcher', folderName);
    this._folderName = folderName;
    this._unwatchFn = unwatchFn;
    this._started = false;
  }
  get folderName() {
    return this._folderName;
  }
  emit(eventName, ...args) {
    // only emit start once
    if (eventName === 'start') {
      if (this._started) {
        return;
      }
      this._started = true;
    }
    this._logger(eventName, ...args);
    super.emit(eventName, ...args);
  }
  close() {
    if (this._unwatchFn) {
      const fn = this._unwatchFn;
      this._unwatchFn = undefined;
      fn();
    }
  }
}

class TreeWatcherDispatcher {
  constructor(treeWatcher) {
    bind(
      this,
      '_startEventForwarder',
      '_emitStartEvent',
    );
    this._emitStartEvent = _.throttle(this._emitStartEvent);
    this._logger = debug('TreeWatcherDispatcher', treeWatcher.folderPath);
    this._listenerManager = new ListenerManager();
    const on = this._listenerManager.on.bind(this._listenerManager);
    on(treeWatcher, 'start', this._startEventForwarder);
    on(treeWatcher, 'create', this._makeEventForwarder('create'));
    on(treeWatcher, 'change', this._makeEventForwarder('change'));
    on(treeWatcher, 'remove', this._makeEventForwarder('remove'));
    this._started = false;
    this._treeWatcher = treeWatcher;
    this._folderWatchers = [];
  }
  get treeWatcher() {
    return this._treeWatcher;
  }
  close() {
    this._listenerManager.removeAll();
    this._treeWatcher = null;
  }
  addFolderWatchers(watchers) {
    this._folderWatchers = this._folderWatchers.concat(watchers);
    if (this._started) {
      process.nextTick(this._emitStartEvent);
    }
  }
  removeAllWatchers() {
    this._folderWatchers = [];
  }
  _startEventForwarder() {
    this._started = true;
    this._emitStartEvent();
  }
  _emitStartEvent() {
    for (const folderWatcher of this._folderWatchers) {
      //      this._logger('emit', 'start');
      folderWatcher.emit('start');
    }
  }
  _makeEventForwarder(eventName) {
    return (filepath, ...args) => {
      this._logger(eventName, filepath);
      const folderName = path.dirname(filepath);
      // TODO: optimize this lookup
      for (const folderWatcher of this._folderWatchers) {
        if (folderWatcher.folderName === folderName) {
          this._logger('emit', eventName, filepath);
          folderWatcher.emit(eventName, filepath, ...args);
        }
      }
    };
  }
}

// holds each FolderWatcher by
// path for this TreeWatcher
export default class WatcherManager {
  constructor() {
    // each entry is array of watchers so
    // you can have more than one per folder
    this._folderWatchersByPath = {};
    this._treeWatchersDispatcherByPath = {};
  }
  close() {
    if (!this.closed) {
      this._closed = true;
      for (const treeWatcherDispatcher of Object.values(this._treeWatchersDispatcherByPath)) {
        const treeWatcher = treeWatcherDispatcher.treeWatcher;
        treeWatcherDispatcher.removeAllWatchers();
        treeWatcherDispatcher.close();
        treeWatcher.close();
      }
      this._treeWatchersDispatcherByPath = {};
      this._folderWatchersByPath = {};
    }
  }
  watch(folderName) {
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
  _unwatch(folderWatcher) {
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
  _shuffleFolderWatchers() {
    // figure out which watchers we need
    const treeWatcherPathsWeNeed = removeChildFolders(Object.keys(this._folderWatchersByPath));
    // figure out of those we have which we need to remove and which we need to add
    const treeWatcherPathsWeHave = Object.keys(this._treeWatchersDispatcherByPath);
    const treeWatcherPathsToRemove = _.difference(treeWatcherPathsWeHave, treeWatcherPathsWeNeed);
    const treeWatcherPathsToAdd = _.difference(treeWatcherPathsWeNeed, treeWatcherPathsWeHave);

    // remove all folder watchers
    for (const treeWatcherDispatcher of Object.values(this._treeWatchersDispatcherByPath)) {
      treeWatcherDispatcher.removeAllWatchers();
    }

    // remove unneeded tree watchers
    for (const treeWatcherPath of treeWatcherPathsToRemove) {
      const treeWatcherDispatcher = this._treeWatchersDispatcherByPath[treeWatcherPath];
      const treeWatcher = treeWatcherDispatcher.treeWatcher;
      treeWatcherDispatcher.close();
      treeWatcher.close();
      delete this._treeWatchersDispatcherByPath[treeWatcherPath];
    }

    // create needed tree watchers
    for (const treeWatcherPath of treeWatcherPathsToAdd) {
      const treeWatcher = new TreeWatcher(treeWatcherPath);
      const treeWatcherDispatcher = new TreeWatcherDispatcher(treeWatcher);
      this._treeWatchersDispatcherByPath[treeWatcherPath] = treeWatcherDispatcher;
    }

    // add folders to dispatchers
    for (const [folderPath, folderWatchersForPath] of Object.entries(this._folderWatchersByPath)) {
      for (let i = 0; i < treeWatcherPathsWeNeed.length; ++i) {
        const treeWatcherPath = treeWatcherPathsWeNeed[i];
        if (folderPath.startsWith(treeWatcherPath)) {
          this._treeWatchersDispatcherByPath[treeWatcherPath].addFolderWatchers(folderWatchersForPath);
          break;
        }
      }
    }
  }
}
