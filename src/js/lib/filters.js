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

import path from 'path';

const imageExtensions = {
  '.jpg': true,
  '.jpeg': true,
  '.png': true,
  '.gif': true,
  '.webp': true,
  '.svg': true,
};

const audioExtensions = {
  '.mp3': true,
  '.ogg': true,
  '.wav': true,
};

const videoExtensions = {
  '.webm': true,
  '.mkv': true,
  '.mp4': true,
  '.m4v': true,
  '.ogv': true,
};

const zipExtensions = {
  '.zip': true,
  '.cbz': true,
};

const rarExtensions = {
  '.rar': true,
  '.cbr': true,
};

function isDotFile(filename) {
  return filename.startsWith('.') || path.basename(filename).startsWith('.');
}

function isImageExtension(filename) {
  return !isDotFile(filename) && imageExtensions[path.extname(filename).toLowerCase()];
}

function isVideoExtension(filename) {
  return !isDotFile(filename) && videoExtensions[path.extname(filename).toLowerCase()];
}

function isAudioExtension(filename) {
  return !isDotFile(filename) && audioExtensions[path.extname(filename).toLowerCase()];
}

function isMediaExtension(filename) {
  return isImageExtension(filename) || isVideoExtension(filename) || isAudioExtension(filename);
}

function isGif(filename) {
  return !isDotFile(filename) && path.extname(filename).toLowerCase() === '.gif';
}

function isRar(filename) {
  return !isDotFile(filename) && rarExtensions[path.extname(filename).toLowerCase()];
}

function isZip(filename) {
  return !isDotFile(filename) && zipExtensions[path.extname(filename).toLowerCase()];
}

function isArchive(filename) {
  return isZip(filename) || isRar(filename);
}

function isMimeVideo(mimeType) {
  return mimeType.startsWith('video/');
}

function isMimeJpeg(mimeType) {
  return mimeType === 'image/jpeg';
}

function isMimeSvg(mimeType) {
  return mimeType.startsWith('image/svg');
}

function isMimeImage(mimeType) {
  return mimeType.startsWith('image/');
}

function isMimeAudio(mimeType) {
  return mimeType.startsWith('audio/');
}

function isMimeGif(mimeType) {
  return mimeType === 'image/gif';
}

function isMimeMedia(mimeType) {
  return isMimeVideo(mimeType) || isMimeImage(mimeType) || isMimeAudio(mimeType);
}

function isArchiveFilenameWeCareAbout(filename) {
  return isMediaExtension(filename)
      && filename.indexOf('__MACOS') < 0;   // hacky I know ...
}

export {
  isAudioExtension,
  isArchive,
  isArchiveFilenameWeCareAbout,
  isDotFile,
  isGif,
  isImageExtension,
  isMediaExtension,
  isMimeGif,
  isMimeJpeg,
  isMimeImage,
  isMimeAudio,
  isMimeMedia,
  isMimeSvg,
  isMimeVideo,
  isRar,
  isVideoExtension,
  isZip,
};
