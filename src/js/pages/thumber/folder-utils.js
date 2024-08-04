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

import * as filters from '../../lib/filters';
import {filenameFromUrl, getObjectsByKeys} from '../../lib/utils';

function getImagesAndVideos(files) {
  const filenames = Object.keys(files);
  const imagesAndVideos = {};
  filenames.forEach((filename) => {
    const fileInfo = files[filename];
    if (!fileInfo.isDirectory && fileInfo.type && filters.isMimeMedia(fileInfo.type)) {
      imagesAndVideos[filename] = fileInfo;
    }
  });
  return imagesAndVideos;
}

function separateFilesByPages(files, filenames) {
  filenames = filenames || Object.keys(files);
  const pages = {};
  for (const filename of filenames) {
    const info = files[filename];
    // might be no thumbnail if old was bad?
    const thumbnail = info.thumbnail;
    if (thumbnail) {
      let page = pages[thumbnail.url];
      if (!page) {
        page = [];
        pages[thumbnail.url] = page;
      }
      page.push(filename);
    }
  }
  return pages;
}

function deleteThumbnails(fs, files) {
  const pages = separateFilesByPages(files);
  for (const pageUrl of Object.keys(pages)) {
    const filename = filenameFromUrl(pageUrl);
    fs.unlinkSync(filename);
  }
}

function getSeparateFilenames(files) {
  const allFilenames = Object.keys(files);
  const folderNames = allFilenames.filter((filename) => files[filename].isDirectory && !filters.isDotFile(filename));
  const fileNames = allFilenames.filter((filename) => !files[filename].isDirectory);
  const archiveNames = fileNames.filter(filters.isArchive);
  const imageAndVideoNames = fileNames.filter(filters.isMediaExtension);
  return {
    imagesAndVideos: imageAndVideoNames,
    folders: folderNames,
    archives: archiveNames,
  };
}

function separateFiles(files) {
  const names = getSeparateFilenames(files);
  const imagesAndVideos = getObjectsByKeys(files, names.imagesAndVideos);
  const archives = getObjectsByKeys(files, names.archives);
  const folders = getObjectsByKeys(files, names.folders);
  return {
    imagesAndVideos: imagesAndVideos,
    archives: archives,
    folders: folders,
  };
}


export {
  deleteThumbnails,
  getSeparateFilenames,
  getImagesAndVideos,
  separateFiles,
  separateFilesByPages,
};
