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

import createLogger from '../../lib/debug';
import { LimitedResourceManager } from '../../lib/limited-resource-manager';
import { MediaLoaderFn, MediaLoaderInfo } from './media-loader-def';
import ThumbnailRenderer from './thumbnail-renderer';

// Manages a bunch of ThumbLoaders
//
// Usage:
//   maker = new ThumbnailMaker(options);
//   maker.on('empty', ...);
//   maker.on('thumbnail' ...);
//   maker.on('small', ...);
//   maker.on('error', ...);
//   maker.addUrl(url, type, filename);
//
// Events:
//   empty:
//     There are no more images queued
//   thumbnail: ({x, y, width, height}, canvas)
//     the canvas has a thumbnail at x, y, width, height
//     you must use the contents of the canvas before exiting this event
//   small: ({url, type, filename})
//     the image was smaller than minSize. The passed values are the same that were
//     passed to addURl
//   error: (??)
//     the url could not be loaded
//
// Why isn't this promise based? Because there is an assumption
// we can't keep the canvas thumbnail around. We need the code that wants
// to use the canvas thumbnail to use it immediately during the 'thumbnail' event.
// when the event returns we are free to re-use the canvas. With a promise
// the canvas would be need to be available forever.

export type ImageInfo = {
  orientation: number;
  width: number;
  height: number;
};

export type ThumbnailMakerInfo = {
  release: () => void;
  canvas: HTMLCanvasElement;
};

export type LoadInfo = ThumbnailMakerInfo & {
  info: ImageInfo;
};

/**
 * returns a function that creates a promise that resolves to ThumbnailMakerInfo
 */
export default function createThumbnailMaker(options: {
  maxWidth: number;
  thumbnailRendererManager: LimitedResourceManager<ThumbnailRenderer>;
  mediaLoaderManager: LimitedResourceManager<MediaLoaderFn>;
}): (filename: string, type: string) => Promise<LoadInfo> {
  const maxWidth = options.maxWidth;
  const thumbnailRendererMgr = options.thumbnailRendererManager;
  const mediaLoaderMgr = options.mediaLoaderManager;
  const logger = createLogger('Thumbnailer');

  /**
   * creates a thumbnail
   *
   * You MUST call release!
   */
  async function makeThumbnail(
    elem: HTMLVideoElement | HTMLImageElement | VideoFrame,
    elemWidth: number,
    elemHeight: number,
    orientation: number,
    maxWidth: number
  ): Promise<{release: () => void, canvas: HTMLCanvasElement}> {
    const tMakerHndl = await thumbnailRendererMgr();
    const tMaker = tMakerHndl.resource;

    return {
      release: tMakerHndl.release,
      canvas: tMaker.makeThumbnail(elem, elemWidth, elemHeight, orientation, maxWidth),
    };
  }

  return async function load(filename: string, type: string): Promise<LoadInfo> {
    logger('load:', filename);
    let loaderHndl: Awaited<ReturnType<typeof mediaLoaderMgr>> | undefined;
    let thumbInfo: ThumbnailMakerInfo | undefined;
    let imgInfo: MediaLoaderInfo | undefined;

    function release() {
      if (thumbInfo) {
        thumbInfo.release();
        thumbInfo = undefined;
      }
      if (imgInfo) {
        imgInfo.release();
        imgInfo = undefined;
      }
      if (loaderHndl) {
        loaderHndl.release();
        loaderHndl = undefined;
      }
    }

    try {
      // get the loader first. It acts as a throttle on loadMeta as well
      loaderHndl = await mediaLoaderMgr();
      const metaInfo = {orientation: 0};
      const imgInfo = await loaderHndl.resource(filename, type);
      const isAtLeastOnePixel = imgInfo.metaData.width > 0 && imgInfo.metaData.height > 0;
      if (!isAtLeastOnePixel) {
        throw new Error('no pixels');
      }
      thumbInfo = await makeThumbnail(imgInfo.elem, imgInfo.metaData.width, imgInfo.metaData.height, metaInfo.orientation, maxWidth);
      // now that the thumbnail is made we don't need the image
      loaderHndl.release();
      return {
        release: release,
        info: {
          ...metaInfo,
          ...imgInfo.metaData,
        },
        canvas: thumbInfo.canvas,
      };
    } catch (e) {
      console.error(e);
      release();
      throw new Error(`could not load ${filename}`, { cause: e });
    }
  };
}
