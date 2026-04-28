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

import * as path from '../../lib/path-helpers.js';
import debug from '../../lib/debug.js';
import KeyHelper from '../../lib/key-helper.js';
import { FoldersByPath, FolderStatus } from '../../lib/folderinfo.js';
import { FileInfo, FilesByPath } from '../../lib/fileinfo.js';

const log = debug('FolderStateHelper');

type FolderStateFileInfo = FileInfo & {
  filename: string;
  sortName: string;
};

export type SortInfo = {
  name: string;
  info: FolderStateFileInfo;
}

type SortFn = (a: SortInfo, b: SortInfo) => number;

function createSortName(name: string) {
  const parts = name.split(/(\d+)/);
  for (let ii = 1; ii < parts.length; ii += 2) {
    parts[ii] = parts[ii].padStart(10, '0');
  }
  return parts.join('').toLowerCase();
}

function getSortName(orig: FolderStateFileInfo): string {
  return orig.sortName;
}

function sortBySortPath(a: SortInfo, b: SortInfo): number {
  const aStr = getSortName(a.info);
  const bStr = getSortName(b.info);
  return aStr < bStr ? -1 : (aStr > bStr ? 1 : 0);
}

function sortBySortName(a: SortInfo, b: SortInfo): number {
  const aStr = path.basename(getSortName(a.info));
  const bStr = path.basename(getSortName(b.info));
  return aStr < bStr ? -1 : (aStr > bStr ? 1 : 0);
}

function sortByNewest(a: SortInfo, b: SortInfo): number {
  const diff = a.info.mtime - b.info.mtime;
  if (diff) {
    return diff > 0 ? -1 : 1;
  }
  const aStr = getSortName(a.info);
  const bStr = getSortName(b.info);
  return aStr < bStr ? -1 : (aStr > bStr ? 1 : 0);
}

function getIndexToInsertBySortPath(array: FolderStateFolder[], folder: FolderStateFolder) {
  return getIndexBySortName(array, folder.sortName);
}

function getIndexToInsertByNewestDate(array: FolderStateFolder[], folder: FolderStateFolder) {
  let ndx;
  for (ndx = 0; ndx < array.length; ++ndx) {
    if (folder.newest > array[ndx].newest) {
      break;
    }
    if (folder.newest === array[ndx].newest &&
        folder.sortName <= array[ndx].sortName) {
      break;
    }
  }
  return ndx;
}

function getIndexBySortName(array: FolderStateFolder[], sortName: string) {
  // switch to binary search
  let ndx;
  for (ndx = 0; ndx < array.length; ++ndx) {
    if (sortName <= array[ndx].sortName) {
      break;
    }
  }
  return ndx;
}

function getIndexToInsertBySortName(array: FolderStateFolder[], folder: FolderStateFolder) {
  const folderName = path.basename(folder.sortName);
  // switch to binary search
  let ndx;
  for (ndx = 0; ndx < array.length; ++ndx) {
    if (folderName <= path.basename(array[ndx].sortName)) {
      break;
    }
  }
  return ndx;
}

function getIndexOfFolderByFolderName(array: FolderStateFolder[], folderName: string) {
  return array.findIndex((folder) => folder.filename === folderName);
}

const kSortModeInfo = {
  sortPath: { indexFn: getIndexToInsertBySortPath,   sortFn: sortBySortPath, icon: 'images/buttons/sort-by-path.svg', hint: 'sort by path', },
  newest:   { indexFn: getIndexToInsertByNewestDate, sortFn: sortByNewest,   icon: 'images/buttons/sort-by-date.svg', hint: 'sort by date', },
  sortName: { indexFn: getIndexToInsertBySortName,   sortFn: sortBySortName, icon: 'images/buttons/sort-by-name.svg', hint: 'sort by name', },
} as const;
export type SortMode = keyof typeof kSortModeInfo;
const sortModes = new KeyHelper(kSortModeInfo);

type FolderStateFolderExtra = FolderStatus & {
  newest: number;
  oldest: number;
};

export type FolderStateFolder = {
  filename: string;
  sortName: string;
  name: string;
  files: SortInfo[];
  totalFiles: number;
} & FolderStateFolderExtra;
export type FolderStateRoot = {
  folders: Array<FolderStateFolder>;
  totalFiles: number;
  indexFn: (array: Array<FolderStateFolder>, folder: FolderStateFolder) => number;
  sortFn: SortFn;
};
class FolderStateHelper {
  static createFolder(filename: string, files: SortInfo[], extra: FolderStateFolderExtra): FolderStateFolder {
    return {
      filename,
      sortName: createSortName(filename),
      name: path.basename(filename),
      files,
      totalFiles: 0,
      ...extra,
    };
  }

  static createRoot(sortMode: SortMode): FolderStateRoot {
    return {
      folders: [],
      totalFiles: 0,
      indexFn: sortModes.value(sortMode).indexFn,
      sortFn: sortModes.value(sortMode).sortFn,
    };
  }

  static sortFiles(folderName: string, files: FilesByPath, sortFn: SortFn) {
    const filenames = Object.keys(files);
    log('updateFiles:', folderName, 'num files:', filenames.length);
    // log('addFiles:', filenames.join('\n'));
    let newest = -1;
    let oldest = Number.MAX_SAFE_INTEGER;
    const newFiles = filenames.map((filename) => {
      const info: FolderStateFileInfo = {
        ...files[filename],
        sortName: createSortName(filename),
        filename: filename,
      };
      if (info.bad) {
        Object.assign(info, {
          type: 'application/octet-stream',
          thumbnail: {
            x: 0,
            y: 0,
            width: 150,   //  FIX: this won't work if we change the thubmnail size :(
            height: 150,
            url: 'images/bad.png',
          }
        });
      } else {
        newest = newest ? Math.max(info.mtime, newest) : info.mtime;
        oldest = oldest ? Math.min(info.mtime, oldest) : info.mtime;
      }
      return {
        name: filename,
        info,
      };
    }).sort(sortFn);
    return {
      newFiles,
      newest,
      oldest,
    };
  }

  static updateFolders(root: FolderStateRoot, folders: FoldersByPath, prefs?: { showEmpty: boolean } | undefined) {
    const newFolders = root.folders.slice();
    let totalFiles = root.totalFiles;
    for (const [folderName, folder] of Object.entries(folders)) {
      const {newFiles, newest, oldest} = FolderStateHelper.sortFiles(folderName, folder.files, root.sortFn);
      const oldNdx = getIndexOfFolderByFolderName(newFolders, folderName);
      if (oldNdx >= 0) {
        const oldFolder = newFolders[oldNdx];
        newFolders.splice(oldNdx, 1);
        totalFiles -= oldFolder.files.length;
      }
      const status = folder.status;
      const haveNewFiles = (prefs && prefs.showEmpty) || newFiles.length > 0;
      if (haveNewFiles || status.scanning || (status.checking && !status.scannedTime)) {
        const newFolder = FolderStateHelper.createFolder(folderName, newFiles, {newest, oldest, ...status});
        const newNdx = root.indexFn(newFolders, newFolder);
        newFolders.splice(newNdx, 0, newFolder);
        totalFiles += newFiles.length;
      }
      log('updated folder:', folderName, 'with', newFiles.length, 'files');
    }
    root.folders = newFolders;
    root.totalFiles = totalFiles;
  }
}

export {
  sortModes,
  FolderStateHelper,
};

