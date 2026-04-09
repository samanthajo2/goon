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
import { otherWindowIPC } from '../../lib/electron-renderer-imports.js';
import debug from '../../lib/debug.js';
import * as archive from './archive.js';
import type { ArchiveFiles } from './archive.js';
import bind from '../../lib/bind.js';
import type { MediaServerStream, MediaManagerChannel } from '../../lib/media-manager-types.js';

type PendingRequest = {
  requestId: number;
  archiveName: string;
  filename: string;
};

class MediaClientProxy {
  private readonly _id: number;
  private readonly _stream: MediaServerStream;
  private readonly _logger: ReturnType<typeof debug>;
  private _archiveName: string | null = null;
  private _requests: PendingRequest[] = [];
  private _currentRequest: PendingRequest | null = null;
  private _archiveFiles: ArchiveFiles = {};
  private _archiveBlobUrlsByFilename: Record<string, string> = {};

  constructor(id: number, stream: MediaServerStream) {
    this._id = id;
    this._stream = stream;
    this._logger = debug('MediaClientProxy', id);
    bind(this, '_sendMediaStatus', '_getMediaStatus', '_disconnect');

    stream.on('getMediaStatus', this._getMediaStatus);
    stream.on('disconnect', this._disconnect);
  }

  close(): void {
    this._closeArchive();
  }

  private _closeArchive(): void {
    Object.values(this._archiveBlobUrlsByFilename).forEach((url) => {
      URL.revokeObjectURL(url);
    });
    this._archiveFiles = {};
    this._archiveBlobUrlsByFilename = {};
    this._archiveName = null;
  }

  private _disconnect(): void {
    this._logger('disconnect');
    this.close();
  }

  private _getMediaStatus(requestId: number, filename: string): void {
    this._logger('requestMedia: reqId:', requestId, 'filename:', filename);
    this._requests.push({
      requestId,
      archiveName: path.dirname(filename),
      filename: path.basename(filename),
    });
    this._processNextRequest();
  }

  private async _sendMediaStatus(): Promise<void> {
    const { requestId, archiveName, filename } = this._currentRequest!;
    const blobInfo = this._archiveFiles[filename];
    let exception: unknown;

    if (blobInfo && !this._archiveBlobUrlsByFilename[filename]) {
      try {
        const blob = await blobInfo.blob();
        this._archiveBlobUrlsByFilename[filename] = URL.createObjectURL(blob);
      } catch (e) {
        exception = e;
      }
    }

    const error = exception
      ? `${exception} for: ${filename}`
      : blobInfo
        ? null
        : `no blobInfo for: ${filename}`;

    this._logger(
      'sendMediaStatus: reqId:', requestId,
      'archive:', archiveName,
      'filename:', filename,
      'error:', error,
    );

    this._stream.send(
      'mediaStatus',
      requestId,
      error,
      blobInfo && !exception
        ? {
          size: blobInfo.size,
          type: blobInfo.type,
          mtime: blobInfo.mtime,
          url: this._archiveBlobUrlsByFilename[filename],
        }
        : undefined,
    );

    this._currentRequest = null;
    this._processNextRequest();
  }

  private async _processNextRequest(): Promise<void> {
    this._logger('processNextRequest');
    if (this._currentRequest || this._requests.length === 0) {
      return;
    }

    this._currentRequest = this._requests.shift()!;
    const request = this._currentRequest;

    if (this._archiveName === request.archiveName) {
      this._sendMediaStatus();
      return;
    }

    this._logger('createDecompressor:', request.archiveName);
    this._closeArchive();
    this._archiveName = request.archiveName;

    try {
      this._archiveFiles = await archive.createDecompressor(request.archiveName);
    } catch {
      this._archiveFiles = {};
    }

    process.nextTick(this._sendMediaStatus);
  }
}

// Accepts connections from MediaManagerClient instances in renderer windows
// and serves archive file blobs on demand.
export default class MediaManagerServer {
  private _nextClientId = 1;
  private readonly _logger: ReturnType<typeof debug>;
  private _clients: MediaClientProxy[] = [];
  private readonly _channelListener: MediaManagerChannel;

  constructor() {
    this._logger = debug('MediaManagerServer');
    this._logger('ctor');
    bind(this, '_handleRegisterMediaManager');

    this._channelListener = otherWindowIPC.createChannel(
      'mediaManager',
    ) as unknown as MediaManagerChannel;
    this._channelListener.on('connect', this._handleRegisterMediaManager);
  }

  private _handleRegisterMediaManager(stream: MediaServerStream): void {
    const id = this._nextClientId++;
    this._logger('registerMediaManager: id =', id);
    const client = new MediaClientProxy(id, stream);
    this._clients.push(client);
    stream.on('disconnect', () => {
      const ndx = this._clients.indexOf(client);
      if (ndx >= 0) {
        this._clients.splice(ndx, 1);
      }
    });
  }

  close(): void {
    this._clients.slice().forEach((client) => {
      client.close();
    });
    this._channelListener.close();
  }
}
