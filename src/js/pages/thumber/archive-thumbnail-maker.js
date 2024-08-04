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
import debug from '../../lib/debug';
import createParallelResourceManager from '../../lib/parallel-resource-manager';
import * as archive from './archive';

const decompressorManager = createParallelResourceManager(2);
const logger = debug('ArchiveThumbnailMaker');

export default async function createThumbnailsForArchive(filepath, baseFilename, thumbnailPageMakerManager) {
  let archiveHandle;
  let archiveFiles;
  let tpmHandle;
  let files;
  let newFiles;
  let startTime;
  const blobUrls = [];

  try {
    logger('waiting for decompressor:', filepath);
    archiveHandle = await decompressorManager();
    logger('decompressing:', filepath);
    startTime = Date.now();
    archiveFiles = await archive.createDecompressor(filepath);

    // create file like info for each blob
    const blobInfos = {};

    // First get all the blobs
    const blobs = await Promise.all(Object.values(archiveFiles).map(async (fileInfo) => fileInfo.blob()));

    // Now get URLs for all the blobs. This way if one of the blobs
    // fails we'll have no objectURLs to discard. Otherwise if we just
    // one blob failed we'd throw, we'd then fall through to cleanup
    // but other promises might still be pending
    Object.values(archiveFiles).forEach((fileInfo, ndx) => {
      const url = URL.createObjectURL(blobs[ndx]);
      blobUrls.push(url);
      blobInfos[url] = {
        url,
        size: fileInfo.size,
        type: fileInfo.type,
        mtime: fileInfo.mtime,
      };
    });
    tpmHandle = await thumbnailPageMakerManager();
    files = await tpmHandle.resource(
      baseFilename,
      [],  // there's never any old files for archives
      blobInfos,
    );

    // Map thumbnails from blobs back to files
    newFiles = {};
    const filesByBlob = {};
    Object.keys(archiveFiles).forEach((filename, ndx) => {
      filesByBlob[blobUrls[ndx]] = filename;
    });
    for (const [blobName, blobInfo] of Object.entries(files)) {
      const filename = filesByBlob[blobName];
      blobInfo.archiveName = filepath;
      newFiles[path.join(filepath, filename)] = {
        archiveName: filepath,
        ...blobInfo,
      };
    }
  } finally {
    if (tpmHandle) {
      tpmHandle.release();
    }
    blobUrls.forEach(URL.revokeObjectURL);
    if (archiveHandle) {
      archiveHandle();
    }
    const elapsedTime = Date.now() - startTime;
    logger('decompression for', filepath, 'took', (elapsedTime * .001).toFixed(1), 'seconds');
  }
  if (!newFiles) {
    throw new Error(`could not read archive: ${filepath}`);
  }
  return newFiles;
}
