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
import fs from 'node:fs';
import EventEmitter from 'node:events';
import { throttle, arrayDifference, CancelableFn } from '../utils.js';
import bind from '../bind.js';
import debug from '../debug.js';
import ListenerManager from '../listener-manager.js';
import TreeWatcher from './tree-watcher.js';

// True when `child` is `parent` or lives beneath it (with a path-separator boundary,
// so ".../a" is not considered a parent of ".../ab").
function isUnder(child: string, parent: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

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
    on(treeWatcher, 'error', (err: unknown) => {
      this._logger.error('watcher error:', err);
    });
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
  private _realpathCache: Map<string, string>;
  private _closed: boolean;

  constructor() {
    this._folderWatchersByPath = {};
    this._treeWatchersDispatcherByPath = {};
    this._realpathCache = new Map();
    this._closed = false;
  }

  // Resolve a folder's realpath (following symlinks), cached. Falls back to the
  // resolved path for paths that don't exist (e.g. in tests) so behavior matches the
  // old string-based collapsing.
  private _realpath(p: string): string {
    let real = this._realpathCache.get(p);
    if (real === undefined) {
      try {
        real = fs.realpathSync(p);
      } catch {
        real = path.normalize(path.resolve(p));
      }
      this._realpathCache.set(p, real);
    }
    return real;
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
      // Drop the cached realpath so a re-watch (e.g. a symlink repointed) re-resolves.
      this._realpathCache.delete(folderName);
    }
    this._shuffleFolderWatchers();
  }

  // Choose the minimal set of recursive tree-watcher roots that covers every watched
  // folder. A folder collapses under a candidate root only when it's beneath it in
  // BOTH the display path and the realpath — so a symlinked folder whose target lives
  // outside its parent's real tree becomes its own root. That matters because
  // @parcel/watcher does not recurse into symlinked directories: without a dedicated
  // subscription, changes under a symlinked folder are never reported.
  private _computeTreeWatcherRoots(folderPaths: string[]): string[] {
    // Shortest first so a parent is considered before its descendants.
    const sorted = [...folderPaths].sort((a, b) => a.length - b.length);
    const roots: string[] = [];
    for (const p of sorted) {
      const covered = roots.some((r) => isUnder(p, r) && isUnder(this._realpath(p), this._realpath(r)));
      if (!covered) {
        roots.push(p);
      }
    }
    return roots;
  }

  private _shuffleFolderWatchers(): void {
    const treeWatcherPathsWeNeed = this._computeTreeWatcherRoots(Object.keys(this._folderWatchersByPath));
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
      // Assign to the root that actually covers this folder (display + real path), so
      // a symlinked folder is served by its own root's watcher, not the parent's.
      const root = treeWatcherPathsWeNeed.find(
        (r) => isUnder(folderPath, r) && isUnder(this._realpath(folderPath), this._realpath(r)),
      );
      if (root) {
        this._treeWatchersDispatcherByPath[root].addFolderWatchers(folderWatchersForPath);
      }
    }
  }
}
