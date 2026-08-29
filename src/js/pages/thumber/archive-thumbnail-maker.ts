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
import debug from '../../lib/debug.js';
import createParallelResourceManager from '../../lib/parallel-resource-manager.js';
import * as archive from './archive.js';
import { LimitedResourceManager } from '../../lib/limited-resource-manager.js';
import { MakeThumbnailPagesFn } from './thumbnail-page-maker-def.js';
import { FileInfo, FilesByPath } from '../../lib/fileinfo.js';

const decompressorManager = createParallelResourceManager(2);
const logger = debug('ArchiveThumbnailMaker');

// Generates thumbnail pages for the media entries inside an archive, returning a
// FilesByPath keyed by each entry's composite path (`path.join(archive, entry)`).
//
// `entryNames`, when given, restricts work to just those entries (the safe entry
// names, matching the keys returned here minus the archive prefix). Only those
// entries are decompressed and thumbnailed — the rest are skipped. This lets a
// virtual folder regenerate thumbnails for the handful of archive members it
// references without decompressing the whole archive. When omitted, every media
// entry in the archive is processed (the folder-view behavior).
export default async function createThumbnailsForArchive(
  filepath: string,
  baseFilename: string,
  thumbnailPageMakerManager: LimitedResourceManager<MakeThumbnailPagesFn>,
  entryNames?: string[]
) {
  let archiveHandle: (() => void) | undefined;
  let tpmHandle: Awaited<ReturnType<typeof thumbnailPageMakerManager>> | undefined;
  let newFiles: FilesByPath | undefined;
  const blobUrls: string[] = [];
  const startTime = Date.now();

  try {
    logger('waiting for decompressor:', filepath);
    archiveHandle = await decompressorManager();
    logger('decompressing:', filepath);
    const allArchiveFiles = await archive.getArchive(filepath);

    // Optionally narrow to just the requested entries (e.g. a virtual folder that
    // references only a few members). Listing the archive is cheap; only the blobs
    // we actually thumbnail below are decompressed.
    const wanted = entryNames ? new Set(entryNames) : undefined;
    const entries = Object.entries(allArchiveFiles).filter(([name]) => !wanted || wanted.has(name));
    const archiveFileNames = entries.map(([name]) => name);
    const archiveFileInfos = entries.map(([, info]) => info);

    // create file like info for each blob
    const blobInfos: FilesByPath = {};

    // First get all the blobs
    const blobs = await Promise.all(archiveFileInfos.map(async (fileInfo) => fileInfo.blob()));

    // Now get URLs for all the blobs. This way if one of the blobs
    // fails we'll have no objectURLs to discard. Otherwise if we just
    // one blob failed we'd throw, we'd then fall through to cleanup
    // but other promises might still be pending
    archiveFileInfos.forEach((fileInfo, ndx) => {
      const url = URL.createObjectURL(blobs[ndx]);
      blobUrls.push(url);
      blobInfos[url] = {
        url,
        // Without this the thumbnailer only has the blob: URL to go on, and
        // captions audio with the blob's uuid instead of the entry's name.
        displayName: archiveFileNames[ndx],
        size: fileInfo.size,
        type: fileInfo.type,
        mtime: fileInfo.mtime,
      } as FileInfo;
    });
    tpmHandle = await thumbnailPageMakerManager();
    const files = await tpmHandle.resource(
      baseFilename,
      {},  // there's never any old files for archives
      blobInfos,
    );

    // Map thumbnails from blobs back to files
    newFiles = {};
    const filesByBlob: Record<string, string> = {};
    archiveFileNames.forEach((filename, ndx) => {
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
