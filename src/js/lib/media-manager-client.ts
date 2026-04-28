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

import debug from './debug.js';
import bind from './bind.js';
import type { Platform } from './platform.js';
import type {
  MediaRequest,
  MediaBlobInfo,
  MediaCallback,
  MediaClientStream,
} from './media-manager-types.js';

// Keeps track of which images/videos can be displayed.
// For local files it always returns immediately with a file:// URL.
// For archive files it asks the thumber window (server) to decompress the
// entry and return a blob URL.
let g_clientCount = 0;

export default class MediaManagerClient {
  private _msgId = 0;
  private _requests: Record<number, MediaCallback> = {};
  private _stream: MediaClientStream | null = null;
  private _streamP: Promise<MediaClientStream>;
  private readonly _logger: ReturnType<typeof debug>;
  private readonly _platform: Platform;

  constructor(platform: Platform) {
    this._platform = platform;
    this._logger = debug('MediaManagerClient', ++g_clientCount);
    bind(this, '_handleMediaStatus');

    this._logger('registerMediaManager');
    this._streamP = platform
      .createChannelStream('mediaManager')
      .then((stream) => {
        this._logger('got stream');
        const typed = stream as unknown as MediaClientStream;
        this._stream = typed;
        typed.on('mediaStatus', this._handleMediaStatus);
        return typed;
      });
    this._streamP.catch((err: unknown) => {
      console.error(err);
    });
  }

  requestMedia(info: MediaRequest, callback: MediaCallback): void {
    this._logger('requestMedia:', JSON.stringify(info));
    this._streamP.then(() => {
      if (info.archiveName) {
        const requestId = ++this._msgId;
        this._requests[requestId] = callback;
        this._stream!.send('getMediaStatus', requestId, info.filename);
      } else {
        process.nextTick(() => {
          callback(undefined, {
            url: this._platform.fileToUrl(info.filename),
            type: info.type,
          });
        });
      }
    });
  }

  private _handleMediaStatus(
    requestId: number,
    error: string | null,
    blobInfo: MediaBlobInfo | undefined,
  ): void {
    this._logger('mediaStatus:', requestId, error, JSON.stringify(blobInfo));
    const callback = this._requests[requestId];
    if (!callback) {
      throw new Error(`no callback for requestId: ${requestId}`);
    }
    delete this._requests[requestId];
    callback(error, blobInfo);
  }

  close(): void {
    this._logger('close');
    if (this._stream) {
      this._stream.close();
      this._stream = null;
    }
  }
}
