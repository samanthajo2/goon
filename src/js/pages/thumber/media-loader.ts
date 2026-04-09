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
/* global VideoFrame */

import path from 'node:path';
import * as filters from '../../lib/filters.js';
import createLogger from '../../lib/debug.js';
import { urlFromFilename } from '../../lib/utils.js';
import { createImageFromString } from '../../lib/string-image.js';
import { MediaElement, MediaLoaderInfo, MediaLoaderFn, MediaMetaData } from './media-loader-def.js';

let g_id = 0;

// Loads an image or video and emits events
// It is meant to be reused since video elements are expensive
//
// Usage:
//
// ```
// loaderFn = createMediaLoader();
// loaded = await loaderFn(someUrl, mimeType);
// use loaded.elem
// loaded.release();
//
// Note: calling loaderFn again before calling loaded.release() is an error!
export default function createMediaLoader(options: {
  maxSeekTime: number,
}): MediaLoaderFn {
  const video = document.createElement('video');
  const image = document.createElement('img');
  const logger = createLogger('MediaLoader', ++g_id);
  const maxSeekTime = options.maxSeekTime;
  let resolveFn: (({ elem, metaData }: {
    elem: MediaElement,
    metaData: MediaMetaData,
    release: () => void,
  }) => void) | undefined;
  let rejectFn: ((elem: HTMLVideoElement | HTMLImageElement) => void) | undefined;
  let busy = false;

  function release() {
    video.removeAttribute('src');
    image.removeAttribute('src');
    busy = false;
  }

  function resolve(elem: MediaElement, metaData: MediaMetaData) {
    const fn = resolveFn;
    resolveFn = undefined;
    rejectFn = undefined;
    fn?.({ elem, metaData, release });
  }

  function reject(elem: HTMLVideoElement | HTMLImageElement) {
    const fn = rejectFn;
    resolveFn = undefined;
    rejectFn = undefined;
    release();
    fn?.(elem);
  }

  video.addEventListener('loadedmetadata', (e: Event) => {
    const videoElement = e.target as HTMLVideoElement;
    const seekTime = Math.min(maxSeekTime, videoElement.duration / 2);
    logger('loadedmetadata: seekTime =', seekTime);
    videoElement.currentTime = seekTime;
    videoElement.muted = true;
  });
  video.addEventListener('seeked', (e) => {
    const videoElement = e.target as HTMLVideoElement;
    logger('seeked: play()');
    videoElement.play();
  });
  video.addEventListener('playing', (e) => {
    const videoElement = e.target as HTMLVideoElement;
    logger('paying: ready:', videoElement.src);
    video.pause();
    resolve(videoElement, { width: video.videoWidth, height: video.videoHeight, duration: video.duration });
  });
  video.addEventListener('error', (e) => {
    const videoElement = e.target as HTMLVideoElement;
    console.warn('could not load:', videoElement.src, e.message);
    videoElement.removeAttribute('src');
    videoElement.load();
    reject(videoElement);
  });

  image.addEventListener('load', (e) => {
    const imageElement = e.target as HTMLImageElement;
    logger('loaded:', imageElement.src);
    resolve(imageElement, { width: imageElement.naturalWidth, height: imageElement.naturalHeight });
  });
  image.addEventListener('error', (e) => {
    const imageElement = e.target as HTMLImageElement;
    console.warn('could not load:', imageElement.src, e.message);
    reject(imageElement);
  });

  return function load(filename: string, type: string) {
    logger('load:', filename);
    if (busy) {
      throw new Error('in use');
    }
    const p = new Promise<MediaLoaderInfo>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    video.pause();
    const url = urlFromFilename(filename);
    if (filters.isMimeVideo(type)) {
      video.setAttribute('src', url);
      video.load();
    } else if (filters.isMimeAudio(type)) {
      image.setAttribute('src', createImageFromString(path.basename(filename)));
    } else {
      image.setAttribute('src', url);
    }
    return p;
  };
}
