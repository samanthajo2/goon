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

 

import cp from 'child_process';
import path from 'node:path';
import debug from '../debug.js';
import LineDecoder from '../line-decoder.js';
import FileChangeType, { FileChangeTypeValue, RawFileChange } from './file-change-types.js';
import { getResourcePath } from '../resources.js';

function alwaysTrue(): boolean {
  return true;
}

// NOTE: In my experience NEVER USE 0 as an ENUM because too many things
// default / coerce to 0 which hides errors
const changeTypeMap: FileChangeTypeValue[] = [FileChangeType.UPDATED, FileChangeType.ADDED, FileChangeType.DELETED];

export default class WinTreeWatcher {
  private _watchedFolder: string;
  private _filter: (path: string) => boolean;
  private _logger: ReturnType<typeof debug>;
  private _verboseLogging: boolean;
  private _startCallback: () => void;
  private _eventCallback: (events: RawFileChange[]) => void;
  private _errorCallback: (error: string) => void;
  private _handle: cp.ChildProcess | null = null;

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
    this._logger = debug('WinTreeWatcher', watchedFolder);
    this._verboseLogging = verboseLogging;
    this._startCallback = () => {
      this._startCallback = () => {};
      this._logger('calling startCallback');
      startCallback();
    };
    this._eventCallback = eventCallback;
    this._errorCallback = errorCallback;
    this._start();
  }

  private _start(): void {
    const args = [path.resolve(this._watchedFolder)];
    if (this._verboseLogging) {
      args.push('-verbose');
    }

    const helperFilePath = getResourcePath('helpers/win32/CodeHelper.exe');
    this._logger('starting:', helperFilePath, ...args);
    this._handle = cp.spawn(helperFilePath, args);

    const stdoutLineDecoder = new LineDecoder();

    this._handle.stdout!.on('data', (data: Buffer) => {
      this._startCallback();
      const rawEvents: RawFileChange[] = [];
      stdoutLineDecoder.write(data).forEach((line) => {
        const eventParts = line.split('|');
        if (eventParts.length === 2) {
          const changeType = Number(eventParts[0]);
          const absolutePath = eventParts[1];

          // File Change Event (0 Changed, 1 Created, 2 Deleted)
          if (changeType >= 0 && changeType < 3) {
            if (!this._filter(absolutePath)) {
              return;
            }
            rawEvents.push({
              type: changeTypeMap[changeType],
              path: absolutePath,
            });
          } else {
            // 3 Logging
            this._logger(eventParts[1]);
          }
        } else {
          this._logger('line:', line);
        }
      });

      if (rawEvents.length > 0) {
        this._eventCallback(rawEvents);
      }
    });

    this._handle.on('error', (error: Error) => this._onError(error));
    this._handle.stderr!.on('data', (data: Buffer) => this._onError(data));
    this._handle.on('exit', (code: number | null, signal: NodeJS.Signals | null) => this._onExit(code, signal));
  }

  private _onError(error: unknown): void {
    this._errorCallback(`${this._logger.getPrefix()} process error: ${error}`);
  }

  private _onExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this._handle) {
      this._errorCallback(`${this._logger.getPrefix()} terminated unexpectedly (code: ${code}, signal: ${signal})`);
      this._start();
    }
  }

  close(): void {
    if (this._handle) {
      this._handle.kill();
      this._handle = null;
    }
  }
}
