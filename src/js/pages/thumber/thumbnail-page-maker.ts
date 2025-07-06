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
import { FileInfo, FilesByPath } from '../../lib/fileinfo';
import {
  filenameFromUrl,
  getDifferentFilenames,
  getObjectsByKeys,
  urlFromFilename,
  range,
} from '../../lib/utils';
import {separateFilesByPages} from './folder-utils';
import { MakeThumbnailPagesFn } from './thumbnail-page-maker-def';

// Given an old and new hash of Object.<string, FileInfo> of
// image and video files makes pages of thumbnails (.png files)
// and returns a promise that resolves to a new Object.<string, FileInfo>
// with orientation added and thumbnail data for each including the URL
// for the page and where on that page the thumbnail is.
//
// Min data Required example
//
//     {
//       "filename1": { type: "mime/type" },
//       "filename2": { type: "mime/type" },
//     }
//
// Data returned
//
//     {
//       "filename1": {
//         type: "mime/type",
//         orientation: 0,      // EXIF orientation
//         width: 100,          // width of original image
//         height: 200,         // height of original image
//         thumbnail: {
//           url: "foo.png",    // URL of png for thumbnail
//           x: 150,            // x position of thumbnail
//           y: 150,            // y position of thumbnail
//           width: 150,        // width position of thumbnail
//           height: 150,       // height position of thumbnail
//         },
//       },
//       "filename2": {
//         ... see above ...
//       },
//     },
//
// Assumptions include
//
// 1. Creating lots of canvases is bad (run out of memory?) so we'll only have one of these
//    ThumbnailPageMaker instances. Although that is not enforced here it is why we keep
//    track of 2D contexts and reuse them
//
// 2. We get passed the data for existing images
//
//    From that we copy all images that
//    have not changed to new pages using the same algorithm
//    for new images. When done process new images.
export default function createThumbnailPageMaker(options: {
  thumbnailWidth: number;
  thumbnailMaker: (filename: string, type: string) => Promise<{
    info: FileInfo,
    canvas: HTMLCanvasElement,
    release: () => void
  }>;
  fs: {
    unlinkSync: (filename: string) => void
    writeFileSync: (filename: string, data: string, encoding: string) => void;
  };
  context2DFactory: () => CanvasRenderingContext2D;
  imgLoader: { loadImage: (url: string) => Promise<HTMLImageElement> };
  pageSize: number;
  thumbnailObserver: (fileInfo: { width: number, height: number }, canvas: HTMLCanvasElement) => void;
}): MakeThumbnailPagesFn {
  type Column = {
    ndx: number;    // column index
    bottom: number; // y position of the bottom of the column
  };
  type Page = {
    ctx: CanvasRenderingContext2D;
    filename: string;
    url: string;
    columns: Column[];
  };

  const {
    thumbnailWidth,
    thumbnailMaker,
    fs,
    context2DFactory,
    imgLoader,
    pageSize,
    thumbnailObserver,
  } = options;
  const logger = createLogger('ThumbnailPageMaker');
  const twoDContexts: CanvasRenderingContext2D[] = [];
  const oldCtx = get2DContext();

  return async function makePages(baseFilename: string, oldFiles: FilesByPath, newFiles: FilesByPath): Promise<FilesByPath> {
    const cacheSuffix = `?cache=${Date.now()}`;

    // go through old images and build up pages
    // copy every same image to new image
    const diffNames = getDifferentFilenames(oldFiles, newFiles);
    const filesToProcess = getObjectsByKeys(newFiles, [...diffNames.changed, ...diffNames.added]);
    const newFileInfos: FilesByPath = {};   // info by filename of each file
    const pages: Page[] = [];          // each new page of thumbnails

    // make lists of the files on each page
    {
      const oldPages = separateFilesByPages(oldFiles, diffNames.same);

      // for each old page, copy the unchanged thumbnails to
      // new pages.
      for (const [oldPageUrl, oldPage] of Object.entries(oldPages)) {
        try {
          const pageImg = await imgLoader.loadImage(oldPageUrl);
          oldPage.forEach((filename) => {
            const info = oldFiles[filename];
            const thumbnail = info.thumbnail;
            const ctx = oldCtx;
            ctx.canvas.width = thumbnail.width;
            ctx.canvas.height = thumbnail.height;
            ctx.drawImage(
              pageImg,
              thumbnail.x, thumbnail.y, thumbnail.width, thumbnail.height,
              0, 0, thumbnail.width, thumbnail.height
            );
            newFileInfos[filename] = {
              ...info,
              thumbnail: addImageToPages(pages, baseFilename, cacheSuffix, filename, ctx.canvas),
            };
          });
          // not really sure what should happen here. Should I some how
          // store a map for urls to page filenames or just assume I can
          // convert?
          const filename = filenameFromUrl(oldPageUrl);
          fs.unlinkSync(filename);
        } catch {
          logger('could not load old page:', oldPageUrl);
          // process the missing files
          oldPage.forEach((filename: string) => {
            filesToProcess[filename] = newFiles[filename];
          });
        }
      }
    }

    // for all the files that changed make a thumbnail and add it to
    // the page
    const imgPromises = Object.keys(filesToProcess).map((filename) => {
      const fileInfo = newFiles[filename];
      const p = thumbnailMaker(filename, fileInfo.type)
        .then((thndl) => {
          const newInfo = Object.assign(fileInfo, thndl.info);
          // The observer must use the canvas IMMEDIATELY.
          try {
            thumbnailObserver(newInfo, thndl.canvas);
            newFileInfos[filename] = {
              ...newInfo,
              thumbnail: addImageToPages(pages, baseFilename, cacheSuffix, filename, thndl.canvas),
            };
          } finally {
            thndl.release();
          }
        })
        .catch(() => {
          newFileInfos[filename] = {bad: true, ...fileInfo};
        });
      return p;
    });

    await Promise.all(imgPromises);
    writePages(pages, baseFilename);
    return newFileInfos;
  };

  function writePage(page: Page, ndx: number, baseFilename: string) {
    const dataUrl = page.ctx.canvas.toDataURL();
    const uu = dataUrl.substring('data:image/png;base64,'.length);
    const filename = `${baseFilename}_${ndx}.png`;
    logger('write:', filename);
    fs.writeFileSync(filename, uu, 'base64');
    put2DContext(page.ctx);
    (page as unknown as { ctx: null }).ctx = null;
  }

  function writePages(pages: Page[], baseFilename: string) {
    logger('write pages: num pages:', pages.length);
    pages.forEach((page, ndx) => {
      writePage(page, ndx, baseFilename);
    });
  }

  function get2DContext(): CanvasRenderingContext2D {
    if (twoDContexts.length) {
      return twoDContexts.pop()!;
    } else {
      return context2DFactory();
    }
  }

  function put2DContext(ctx: CanvasRenderingContext2D) {
    ctx.canvas.width = 1;
    ctx.canvas.height = 1;
    twoDContexts.push(ctx);
  }

  function getExistingPageForNewThumbnail(pages: Page[], thumbnailHeight: number) {
    for (let ii = 0; ii < pages.length; ++ii) {
      // TODO: use reduce
      const page = pages[ii];
      let shortest = page.columns[0];
      page.columns.forEach((column) => {
        if (column.bottom < shortest.bottom) {
          shortest = column;
        }
      });
      if (page.ctx.canvas.height - shortest.bottom >= thumbnailHeight) {
        return {
          page: page,
          column: shortest,
        };
      }
    }
    return undefined;
  }

  function getPageForNewThumbnail(pages: Page[], baseFilename: string, thumbnailHeight: number) {
    let pageColumnPair = getExistingPageForNewThumbnail(pages, thumbnailHeight);
    if (!pageColumnPair) {
      const filename = `${baseFilename}_${pages.length}.png`;
      const page = createPage(filename);
      pages.push(page);
      pageColumnPair = {
        page: page,
        column: page.columns[0],
      };
    }
    return pageColumnPair;
  }

  function createPage(filename: string): Page {
    const url = urlFromFilename(filename);
    const ctx = get2DContext();
    ctx.canvas.width = pageSize;
    ctx.canvas.height = pageSize;
    const numColumns = ctx.canvas.width / thumbnailWidth | 0;
    const page: Page = {
      filename,
      url,
      columns: range<Column>(numColumns, i => ({ ndx: i, bottom: 0 })),
      ctx,
    };
    return page;
  }

  function addImageToPages(pages: Page[], baseFilename: string, cacheSuffix: string, filename: string, srcCanvas: HTMLCanvasElement) {
    const pageColumnPair = getPageForNewThumbnail(pages, baseFilename, srcCanvas.height);
    const page = pageColumnPair.page;
    const column = pageColumnPair.column;
    const x = column.ndx * thumbnailWidth;
    const y = column.bottom;
    logger('addImage:', filename, x, y);
    page.ctx.drawImage(srcCanvas, x, y);
    column.bottom += srcCanvas.height;
    return {
      x,
      y,
      width: srcCanvas.width,
      height: srcCanvas.height,
      url: `${page.url}${cacheSuffix}`,
      pageSize,
    };
  }
}
