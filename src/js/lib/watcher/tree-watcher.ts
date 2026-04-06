// parts of this code from Visual Studio Code
/*
MIT License

Copyright (c) 2015 - present Microsoft Corporation

All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import EventEmitter from 'node:events';
import path from 'node:path';
import _ from 'lodash';
import debug from '../debug';
import WinTreeWatcher from './win-tree-watcher';
import ChokidarTreeWatcher from './chokidar-tree-watcher';
import FileChangeType, { RawFileChange } from './file-change-types';

type RawWatcher = WinTreeWatcher | ChokidarTreeWatcher;

 

export default class TreeWatcher extends EventEmitter {
  private _logger: ReturnType<typeof debug>;
  private _folderpath: string;
  private _bufferedEvents: RawFileChange[];
  private _rawWatcher: RawWatcher;
  private _throttledSendEvents!: _.DebouncedFunc<() => void>;

  constructor(folderpath: string) {
    super();
    this._logger = debug('TreeWatcher', folderpath);
    this._folderpath = folderpath;
    this._throttledSendEvents = _.throttle(this._doSendEvents.bind(this), 250);
    this._bufferedEvents = [];
    const filter = (): boolean => true;
    const verbose = false;
    this._rawWatcher = process.platform.startsWith('win')
      ? new WinTreeWatcher(folderpath, filter, this._onStart.bind(this), this._onRawEvent.bind(this), this._onError.bind(this), verbose)
      : new ChokidarTreeWatcher(folderpath, filter, this._onStart.bind(this), this._onRawEvent.bind(this), this._onError.bind(this), verbose);
  }

  get folderPath(): string {
    return this._folderpath;
  }

  private _doSendEvents(): void {
    if (this._bufferedEvents.length === 0) {
      return;
    }

    const events = normalize(this._bufferedEvents);
    this._bufferedEvents = [];
    events.forEach((event) => {
      switch (event.type) {
        case FileChangeType.ADDED:
          this.emit('create', event.path);
          break;
        case FileChangeType.UPDATED:
          this.emit('change', event.path);
          break;
        case FileChangeType.DELETED:
          this.emit('remove', event.path);
          break;
        default:
          throw new Error('unknown event type');
      }
    });
  }

  private _onRawEvent(rawEvents: RawFileChange[]): void {
    this._bufferedEvents.splice(this._bufferedEvents.length, 0, ...rawEvents);
    this._throttledSendEvents();
  }

  private _onStart(_e?: unknown): void {
    this.emit('start');
  }

  private _onError(e: unknown): void {
    this._logger.error(e);
  }

  close(): Promise<void> | void {
    this._logger('close');
    if (this._rawWatcher) {
      return this._rawWatcher.close();
    }
  }
}


function isParent(p: string, candidate: string): boolean {
  return p.indexOf(candidate + path.sep) === 0;
}

function normalize(changes: RawFileChange[]): RawFileChange[] {
  const normalizer = new EventNormalizer();
  for (const event of changes) {
    normalizer.processEvent(event);
  }
  return normalizer.normalize();
}

class EventNormalizer {
  private normalized: RawFileChange[];
  private mapPathToChange: Record<string, RawFileChange>;

  constructor() {
    this.normalized = [];
    this.mapPathToChange = {};
  }

  processEvent(event: RawFileChange): void {
    const existingEvent = this.mapPathToChange[event.path];
    if (existingEvent) {
      const currentChangeType = existingEvent.type;
      const newChangeType = event.type;

      if (currentChangeType === FileChangeType.ADDED && newChangeType === FileChangeType.DELETED) {
        delete this.mapPathToChange[event.path];
        this.normalized.splice(this.normalized.indexOf(existingEvent), 1);
      } else if (currentChangeType === FileChangeType.DELETED && newChangeType === FileChangeType.ADDED) {
        existingEvent.type = FileChangeType.UPDATED;
      } else if (currentChangeType === FileChangeType.ADDED && newChangeType === FileChangeType.UPDATED) {
        // Do nothing. Keep the created event
      } else {
        existingEvent.type = newChangeType;
      }
    } else {
      this.normalized.push(event);
      this.mapPathToChange[event.path] = event;
    }
  }

  normalize(): RawFileChange[] {
    const addedChangeEvents: RawFileChange[] = [];
    const deletedPaths: string[] = [];

    const deleted = this.normalized.filter(e => {
      if (e.type !== FileChangeType.DELETED) {
        addedChangeEvents.push(e);
        return false;
      }
      return true;
    });

    const shortestFirst = deleted.sort((e1, e2) => e1.path.length - e2.path.length);

    const parentsWithoutChildren = shortestFirst.filter(e => {
      if (deletedPaths.some(d => isParent(e.path, d))) {
        return false;
      }
      deletedPaths.push(e.path);
      return true;
    });

    return [...parentsWithoutChildren, ...addedChangeEvents];
  }
}
