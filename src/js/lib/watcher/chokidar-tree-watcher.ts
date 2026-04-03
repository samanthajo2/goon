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

import chokidar from 'chokidar';
import debug from '../debug';
import FileChangeType, { FileChangeTypeValue, RawFileChange } from './file-change-types';
import ListenerManager from '../listener-manager';

function alwaysTrue(): boolean {
  return true;
}

function getEventName(eventType: FileChangeTypeValue): string {
  for (const key of Object.keys(FileChangeType) as (keyof typeof FileChangeType)[]) {
    if (FileChangeType[key] === eventType) {
      return key;
    }
  }
  throw new Error('unknown event type');
}

export default class ChokidarTreeWatcher {
  private _watchedFolder: string;
  private _filter: (path: string) => boolean;
  private _logger: ReturnType<typeof debug>;
  private _verboseLogging: boolean;
  private _startCallback: () => void;
  private _eventCallback: (events: RawFileChange[]) => void;
  private _errorCallback: (error: string) => void;
  private _listenerManager: ListenerManager;
  private _chokidar: import('chokidar').FSWatcher | null = null;

  constructor(
    watchedFolder: string,
    filter: ((path: string) => boolean) | null,
    startCallback: () => void,
    eventCallback: (events: RawFileChange[]) => void,
    errorCallback: (error: string) => void,
    verboseLogging: boolean,
  ) {
    this._watchedFolder = watchedFolder;
    this._filter = filter || alwaysTrue;
    this._logger = debug('ChokidarTreeWatcher', watchedFolder);
    this._verboseLogging = verboseLogging;
    this._startCallback = () => {
      this._startCallback = () => {};
      this._logger('calling startCallback');
      startCallback();
    };
    this._eventCallback = eventCallback;
    this._errorCallback = errorCallback;
    this._listenerManager = new ListenerManager();
    this._start();
  }

  private _start(): void {
    this._logger('start');
    const on = this._listenerManager.on.bind(this._listenerManager);
    this._chokidar = chokidar.watch(this._watchedFolder);
    on(this._chokidar, 'error', this._onError.bind(this));
    on(this._chokidar, 'ready', () => {
      this._logger('ready');
      on(this._chokidar!, 'add', this._makeEventHandler(FileChangeType.ADDED));
      on(this._chokidar!, 'change', this._makeEventHandler(FileChangeType.UPDATED));
      on(this._chokidar!, 'unlink', this._makeEventHandler(FileChangeType.DELETED));
      on(this._chokidar!, 'addDir', this._makeEventHandler(FileChangeType.ADDED));
      on(this._chokidar!, 'unlinkDir', this._makeEventHandler(FileChangeType.DELETED));
      this._startCallback();
    });
  }

  private _makeEventHandler(eventType: FileChangeTypeValue): (filename: string) => void {
    const eventName = getEventName(eventType);
    return (filename: string) => {
      this._logger(eventName, filename);
      this._eventCallback([{ type: eventType, path: filename }]);
    };
  }

  private _onError(error: unknown): void {
    this._errorCallback(`${this._logger.getPrefix()} process error: ${error}`);
  }

  async close(): Promise<void> {
    this._logger('close');
    if (this._chokidar) {
      this._listenerManager.removeAll();
      await this._chokidar.close();
      this._chokidar = null;
    }
  }
}
