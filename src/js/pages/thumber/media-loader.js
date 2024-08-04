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
import * as filters from '../../lib/filters';
import createLogger from '../../lib/debug';
import { urlFromFilename } from '../../lib/utils';
import { createImageFromString } from '../../lib/string-image';

let g_id = 0;

// Loads an image or video and emits events
// It is meant to be reused since video elements are expensive
//
// Usage:
//
//   loader = new ThumbLoader();
//   loader.on('ready', ...);
//   loader.on('error', ...);
//   loader.on('free', ...);
//   loader.load({url: url}, id);
//
// Events:
//   ready: (element, width, height)
//      emitted when the video/image as loaded
//   free:
//      emitted when it's safe to request another url. You will always get a
//      free event even if there was an error
//   error: (element)
//      emitted when there was an error trying to load URL
//
// Why isn't this promise based? Because there is an assumption
// we can't keep the image around. We need the code that wants
// to use the image to use it immediately during the 'ready' event.
// when the event returns we are free to re-use the image. With a promise
// the image would be need to be available forever.
export default function createMediaLoader(options) {
  const video = document.createElement('video');
  const image = document.createElement('img');
  const logger = createLogger('MediaLoader', ++g_id);
  const maxSeekTime = options.maxSeekTime;
  let resolveFn;
  let rejectFn;

  function resolve(elem, width, height) {
    const fn = resolveFn;
    resolveFn = undefined;
    rejectFn = undefined;
    fn({ elem, width, height });
  }

  function reject(...args) {
    const fn = rejectFn;
    resolveFn = undefined;
    rejectFn = undefined;
    fn(...args);
  }

  video.addEventListener('loadedmetadata', (e) => {
    const seekTime = Math.min(maxSeekTime, e.target.duration / 2);
    e.target.currentTime = seekTime;
    e.target.muted = true;
  });
  video.addEventListener('seeked', (e) => {
    e.target.play();
  });
  video.addEventListener('playing', (e) => {
    logger('ready:', e.target.src);
    e.target.pause();
    resolve(e.target, e.target.videoWidth, e.target.videoHeight);
  });
  // video.addEventListener('pause', (e) => {
  //   e.target.removeAttribute('src');
  //   e.target.load();
  // });
  video.addEventListener('error', (e) => {
    console.warn('could not load:', e.target.src, e);
    e.target.removeAttribute('src');
    e.target.load();
    reject(e.target);
  });

  image.addEventListener('load', (e) => {
    logger('loaded:', e.target.src);
    resolve(e.target, e.target.naturalWidth, e.target.naturalHeight);
  });
  image.addEventListener('error', (e) => {
    console.warn('could not load:', e.target.src, e);
    reject(e.target);
  });

  return function load(filename, type) {
    logger('load:', filename);
    if (resolveFn) {
      throw new Error('in use');
    }
    const p = new Promise((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    video.pause();
    const url = urlFromFilename(filename);
    if (filters.isMimeVideo(type)) {
      video.src = url;
      video.load();
    } else if (filters.isMimeAudio(type)) {
      image.src = createImageFromString(path.basename(filename));
    } else {
      image.src = url;
    }
    return p;
  };
}
