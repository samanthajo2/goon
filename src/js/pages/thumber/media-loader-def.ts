/*
Copyright 2025 SamanthaJo

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

export type MediaElement = HTMLImageElement | HTMLVideoElement;

export type MediaMetaData = {
  width: number;
  height: number;
  duration?: number;
};

export type MediaLoaderInfo = {
  elem: MediaElement,
  metaData: MediaMetaData
  release: () => void,
}

// cacheBust (the file's mtime) is appended to the source URL so re-thumbnailing an
// edited file doesn't reuse Chromium's cached decode of the old contents.
//
// displayName is the name to show the user. It matters for archive entries,
// whose `filename` is a blob: URL carrying neither a readable name nor an
// extension; everything else can fall back to the filename.
export type MediaLoaderFn = (
  filename: string,
  type: string,
  cacheBust?: string | number,
  displayName?: string,
) => Promise<MediaLoaderInfo>;
