/*
  Recursive folder watcher backed by @parcel/watcher.

  Replaces the chokidar-based watcher on macOS/Linux. chokidar 5 dropped its
  fsevents dependency and watches via non-recursive fs.watch (kqueue on macOS).
  When a watched folder lives on a network/removable mount that disappears, the
  kqueue fd goes bad and libuv aborts the whole process from uv__io_poll — an
  abort that no JS 'error' handler can catch. @parcel/watcher uses the native
  FSEvents (macOS) / inotify (Linux) APIs on their own thread, which report
  unmounts as recoverable errors instead of aborting.

  Contract matches WinTreeWatcher / ChokidarTreeWatcher:
    - startCallback() is called once when watching is active.
    - eventCallback(events) delivers batches of { type, path } changes.
    - errorCallback(message) reports errors as strings.
  Like chokidar here, no events are emitted for pre-existing files; callers do
  their own initial readdir and use the watcher only for subsequent changes.
*/

import { realpath } from 'node:fs/promises';
import path from 'node:path';
import watcher, { type AsyncSubscription, type Event as ParcelEvent } from '@parcel/watcher';
import debug from '../debug.js';
import FileChangeType, { FileChangeTypeValue, RawFileChange } from './file-change-types.js';

function alwaysTrue(): boolean {
  return true;
}

const changeTypeMap: Record<ParcelEvent['type'], FileChangeTypeValue> = {
  create: FileChangeType.ADDED,
  update: FileChangeType.UPDATED,
  delete: FileChangeType.DELETED,
};

export default class ParcelTreeWatcher {
  private _watchedFolder: string;
  private _filter: (path: string) => boolean;
  private _logger: ReturnType<typeof debug>;
  private _verboseLogging: boolean;
  private _startCallback: () => void;
  private _eventCallback: (events: RawFileChange[]) => void;
  private _errorCallback: (error: string) => void;
  private _subscription: AsyncSubscription | null = null;
  private _closed = false;
  // @parcel/watcher resolves symlinks and reports realpath'd paths. Callers use
  // the path they passed in, so we translate reported paths back into that space.
  private _realBase: string;

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
    this._logger = debug('ParcelTreeWatcher', watchedFolder);
    this._verboseLogging = verboseLogging;
    this._startCallback = () => {
      this._startCallback = () => {};
      this._logger('calling startCallback');
      startCallback();
    };
    this._eventCallback = eventCallback;
    this._errorCallback = errorCallback;
    this._realBase = watchedFolder;
    this._start();
  }

  private async _start(): Promise<void> {
    this._logger('start');
    try {
      // Resolve the watched folder to the same realpath @parcel/watcher reports,
      // so we can map event paths back to the caller's (possibly symlinked) path.
      try {
        this._realBase = await realpath(this._watchedFolder);
      } catch {
        this._realBase = this._watchedFolder;
      }
      const subscription = await watcher.subscribe(this._watchedFolder, this._onEvents.bind(this));
      // close() may have been called while subscribe() was in flight.
      if (this._closed) {
        await subscription.unsubscribe();
        return;
      }
      this._subscription = subscription;
      this._logger('ready');
      this._startCallback();
    } catch (err) {
      this._onError(err);
    }
  }

  private _onEvents(err: Error | null, events: ParcelEvent[]): void {
    if (err) {
      this._onError(err);
      return;
    }
    const rawEvents: RawFileChange[] = [];
    for (const event of events) {
      if (this._verboseLogging) {
        this._logger(event.type, event.path);
      }
      const eventPath = this._mapPath(event.path);
      // Drop events on the watched root itself; callers only expect child changes
      // (and @parcel/watcher may emit a spurious create for the root on startup).
      if (eventPath === null || eventPath === this._watchedFolder) {
        continue;
      }
      if (!this._filter(eventPath)) {
        continue;
      }
      rawEvents.push({ type: changeTypeMap[event.type], path: eventPath });
    }
    if (rawEvents.length > 0) {
      this._eventCallback(rawEvents);
    }
  }

  // Translate a realpath'd path reported by @parcel/watcher back into the
  // caller's path space (the folder they asked us to watch). Returns null for
  // paths outside the watched tree.
  private _mapPath(reported: string): string | null {
    if (reported === this._realBase) {
      return this._watchedFolder;
    }
    const prefix = this._realBase + path.sep;
    if (reported.startsWith(prefix)) {
      return this._watchedFolder + path.sep + reported.slice(prefix.length);
    }
    return this._realBase === this._watchedFolder ? reported : null;
  }

  private _onError(error: unknown): void {
    this._errorCallback(`${this._logger.getPrefix()} process error: ${error}`);
  }

  async close(): Promise<void> {
    this._logger('close');
    this._closed = true;
    if (this._subscription) {
      const subscription = this._subscription;
      this._subscription = null;
      await subscription.unsubscribe();
    }
  }
}
