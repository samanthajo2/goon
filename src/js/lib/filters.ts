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

import path from 'node:path';

const imageExtensions = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
]);

const audioExtensions = new Set([
  '.mp3',
  '.ogg',
  '.wav',
]);

const videoExtensions = new Set([
  '.webm',
  '.mkv',
  '.mp4',
  '.m4v',
  '.ogv',
]);

const zipExtensions = new Set([
  '.zip',
  '.cbz',
]);

const rarExtensions = new Set([
  '.rar',
  '.cbr',
]);

export function isDotFile(filename: string): boolean {
  return filename.startsWith('.') || path.basename(filename).startsWith('.');
}

export function isImageExtension(filename: string): boolean {
  return !isDotFile(filename) && imageExtensions.has(path.extname(filename).toLowerCase());
}

export function isVideoExtension(filename: string): boolean {
  return !isDotFile(filename) && videoExtensions.has(path.extname(filename).toLowerCase());
}

export function isAudioExtension(filename: string): boolean {
  return !isDotFile(filename) && audioExtensions.has(path.extname(filename).toLowerCase());
}

export function isMediaExtension(filename: string): boolean {
  return isImageExtension(filename) || isVideoExtension(filename) || isAudioExtension(filename);
}

export function isGif(filename: string): boolean {
  return !isDotFile(filename) && path.extname(filename).toLowerCase() === '.gif';
}

export function isRar(filename: string): boolean {
  return !isDotFile(filename) && rarExtensions.has(path.extname(filename).toLowerCase());
}

export function isZip(filename: string): boolean {
  return !isDotFile(filename) && zipExtensions.has(path.extname(filename).toLowerCase());
}

export function isArchive(filename: string): boolean {
  return isZip(filename) || isRar(filename);
}

export function isMimeVideo(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

export function isMimeJpeg(mimeType: string): boolean {
  return mimeType === 'image/jpeg';
}

export function isMimeSvg(mimeType: string): boolean {
  return mimeType.startsWith('image/svg');
}

export function isMimeImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function isMimeAudio(mimeType: string): boolean {
  return mimeType.startsWith('audio/');
}

export function isMimeGif(mimeType: string): boolean {
  return mimeType === 'image/gif';
}

export function isMimeMedia(mimeType: string): boolean {
  return isMimeVideo(mimeType) || isMimeImage(mimeType) || isMimeAudio(mimeType);
}

export function isArchiveFilenameWeCareAbout(filename: string): boolean {
  return isMediaExtension(filename)
      && filename.indexOf('__MACOS') < 0;   // hacky I know ...
}
