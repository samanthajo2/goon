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

import otherWindowIPC from 'other-window-ipc';
import debug from './debug';
import bind from './bind';
import {urlFromFilename} from './utils';

// Keeps track of which images/videos can be displayed
// For files that are local it just always returns they exist
// For archives though they only exist if the corresponding blob exists
//
// One question is should we maintain a cache on this side?
//
// Two ideas
//
// 1.  State on server
//
//     Always ask server for file (if blob)
//
//     Server keeps list
//
// 2.  State on client
//
//     Server just loads blobs and then tells client
//     about all blobs added/removed
//
//     Client then asks itself
let g_clientCount = 0;

export default class MediaManagerClient {
  constructor() {
    this._msgId = 0;
    this._requests = {};
    this._logger = debug('MediaManagerClient', ++g_clientCount);
    bind(
      this,
      '_handleMediaStatus',
    );

    this._logger('registerMediaManager');
    this._streamP = otherWindowIPC.createChannelStream('mediaManager');
    this._streamP.then((stream) => {
      this._logger('got stream');
      this._stream = stream;
      stream.on('mediaStatus', this._handleMediaStatus);
    }).catch((err) => {
      console.error(err);
    });
  }

  requestMedia(info, callback) {
    this._logger('requestMedia:', JSON.stringify(info));
    this._streamP.then(() => {
      if (info.archiveName) {
        const requestId = ++this._msgId;
        this._requests[requestId] = callback;
        this._stream.send('getMediaStatus', requestId, info.filename);
      } else {
        process.nextTick(() => {
          callback(undefined, {
            url: urlFromFilename(info.filename),
            type: info.type,
          });
        });
      }
    });
  }

  _handleMediaStatus(requestId, error, blobInfo) {
    this._logger('mediaStatus:', requestId, error, JSON.stringify(blobInfo));
    const callback = this._requests[requestId];
    if (!callback) {
      throw new Error(`no callback for requestId: ${requestId}`);
    }
    delete this._requests[requestId];
    callback(error, blobInfo);
  }

  close() {
    this._logger('close');
    if (this._stream) {
      this._stream.close();
      this._stream = null;
    }
  }
}

