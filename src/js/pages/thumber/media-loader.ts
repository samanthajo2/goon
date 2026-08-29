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

import * as filters from '../../lib/filters.js';
import createLogger from '../../lib/debug.js';
import { urlFromFilename } from '../../lib/utils.js';
import { createImageFromString } from '../../lib/string-image.js';
import { getEmbeddedArt } from './embedded-art.js';
import { displayBasename } from '../../lib/path-helpers.js';
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
  const audio = document.createElement('audio');
  const image = document.createElement('img');
  const logger = createLogger('MediaLoader', ++g_id);
  const maxSeekTime = options.maxSeekTime;
  let resolveFn: (({ elem, metaData }: {
    elem: MediaElement,
    metaData: MediaMetaData,
    release: () => void,
  }) => void) | undefined;
  let rejectFn: ((elem: HTMLMediaElement | HTMLImageElement) => void) | undefined;
  let busy = false;
  // When loading audio we show an image but report the audio's duration: the
  // file's own cover art when it has some, otherwise a generated square.
  let audioBaseName = '';
  // Where to read the art from: a path, or a blob: URL for an archive entry.
  let audioLocation = '';
  let audioDuration: number | undefined;
  let artObjectUrl: string | undefined;
  // Reading cover art is async, so a load can be superseded while it's in
  // flight. Stamp each load and drop any continuation that isn't current, or a
  // stale read would scribble on the shared <img>.
  let loadId = 0;

  function releaseArtObjectUrl() {
    if (artObjectUrl) {
      URL.revokeObjectURL(artObjectUrl);
      artObjectUrl = undefined;
    }
  }

  function release() {
    video.removeAttribute('src');
    audio.removeAttribute('src');
    image.removeAttribute('src');
    // Safe here: the consumer has already drawn the element to a canvas by the
    // time it releases (see thumbnail-maker).
    releaseArtObjectUrl();
    busy = false;
  }

  function resolve(elem: MediaElement, metaData: MediaMetaData) {
    const fn = resolveFn;
    resolveFn = undefined;
    rejectFn = undefined;
    fn?.({ elem, metaData, release });
  }

  function reject(elem: HTMLMediaElement | HTMLImageElement) {
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

  audio.addEventListener('loadedmetadata', (e: Event) => {
    const audioElement = e.target as HTMLAudioElement;
    logger('audio loadedmetadata: duration =', audioElement.duration);
    audioDuration = audioElement.duration;
    const forLoadId = loadId;
    void (async () => {
      const art = await getEmbeddedArt(audioLocation, audioBaseName);
      if (forLoadId !== loadId) {
        return;
      }
      if (art) {
        logger('using embedded art:', art.mimeType, art.data.length, 'bytes');
        artObjectUrl = URL.createObjectURL(new Blob([art.data], { type: art.mimeType }));
        image.setAttribute('src', artObjectUrl);
      } else {
        image.setAttribute('src', createImageFromString(audioBaseName));
      }
    })();
  });
  audio.addEventListener('error', (e) => {
    const audioElement = e.target as HTMLAudioElement;
    console.warn('could not load:', audioElement.src, e.message);
    audioElement.removeAttribute('src');
    audioElement.load();
    reject(audioElement);
  });

  image.addEventListener('load', (e) => {
    const imageElement = e.target as HTMLImageElement;
    logger('loaded:', imageElement.src);
    resolve(imageElement, { width: imageElement.naturalWidth, height: imageElement.naturalHeight, duration: audioDuration });
  });
  image.addEventListener('error', (e) => {
    const imageElement = e.target as HTMLImageElement;
    console.warn('could not load:', imageElement.src, e.message);
    reject(imageElement);
  });

  return function load(filename: string, type: string, cacheBust?: string | number, displayName?: string) {
    logger('load:', filename);
    if (busy) {
      throw new Error('in use');
    }
    const p = new Promise<MediaLoaderInfo>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    ++loadId;
    releaseArtObjectUrl();
    video.pause();
    audioDuration = undefined;
    // Append the mtime so an edited file (same path) isn't served from Chromium's
    // decoded-image cache — and so re-setting the same <img>/<video> src actually
    // reloads. Only for file:// URLs (they accept a query in Electron); a query on a
    // blob: URL (archive entries) would corrupt its id and fail to load.
    const base = urlFromFilename(filename);
    const url = (cacheBust !== undefined && base.startsWith('file:')) ? `${base}?cb=${cacheBust}` : base;
    if (filters.isMimeVideo(type)) {
      video.setAttribute('src', url);
      video.load();
    } else if (filters.isMimeAudio(type)) {
      // For an archive entry `filename` is a blob: URL, so its basename is a
      // uuid; the entry's real name only arrives via displayName.
      audioBaseName = displayBasename(displayName ?? filename);
      audioLocation = filename;
      audio.setAttribute('src', url);
      audio.load();
    } else {
      image.setAttribute('src', url);
    }
    return p;
  };
}
