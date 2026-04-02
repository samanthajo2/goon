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

// Shared types for the MediaManager IPC protocol between renderer windows.
//
// Protocol flow:
//   Client                              Server
//   ------                              ------
//   createChannelStream('mediaManager') createChannel('mediaManager')
//   stream.send('getMediaStatus',  -->  stream.on('getMediaStatus', ...)
//     requestId, filename)
//                                  <--  stream.send('mediaStatus',
//                                         requestId, error, blobInfo?)
//   stream.on('mediaStatus', ...)

// The info object passed to requestMedia. In practice this is always a
// FolderStateFileInfo (FileInfo & { filename: string }) from the view layer,
// but typed here to only the fields this module actually needs.
export type MediaRequest = {
  filename: string;
  archiveName?: string;
  type: string;
};

// Blob info sent by the server for archive files.
export type MediaBlobInfo = {
  size: number;
  type: string;
  mtime: number;
  url: string;
};

// Result delivered to the MediaCallback. For non-archive files the server
// constructs this locally; for archive files it matches MediaBlobInfo.
export type MediaResult = {
  url: string;
  type: string;
  size?: number;
  mtime?: number;
};

export type MediaCallback = (error: string | null | undefined, result?: MediaResult) => void;

// Typed view of the IPC stream on the client side (renderer requesting media).
export interface MediaClientStream {
  on(event: 'mediaStatus', listener: (requestId: number, error: string | null, blobInfo: MediaBlobInfo | undefined) => void): void;
  send(event: 'getMediaStatus', requestId: number, filename: string): void;
  close(): void;
}

// Typed view of the IPC stream on the server side (thumber window serving media).
export interface MediaServerStream {
  on(event: 'getMediaStatus', listener: (requestId: number, filename: string) => void): void;
  on(event: 'disconnect', listener: () => void): void;
  send(event: 'mediaStatus', requestId: number, error: string | null, blobInfo?: MediaBlobInfo): void;
  close(): void;
}

// Typed channel listener used by the server to accept incoming connections.
export interface MediaManagerChannel {
  on(event: 'connect', listener: (stream: MediaServerStream) => void): void;
  close(): void;
}
