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
import fs from 'fs';
import {sync as readDirTreeSync} from '../lib/readdirtree';
import FolderData from '../pages/thumber/folder-data';
import * as utils from '../lib/utils';
import * as filters from '../lib/filters';
import {separateFiles} from '../pages/thumber/folder-utils';

let lastLineLength = 0;
function logLine(...args) {
  const line = [...args].join(' ');
  process.stdout.write(`${line.padEnd(lastLineLength)}\r`);
  lastLineLength = line.length;
}

function logDir(filepath) {
  logLine('readdir:', filepath);
}

export default function compareFoldersToCache(baseFolders, options) {
  const userDataDir = options.userDataDir;
  // get listings of all folders
  const realFolders = {};
  baseFolders.forEach((baseFolder) => {
    logLine('readdir:', baseFolder);
    if (utils.fileExistsSync(baseFolder)) {
      const tree = readDirTreeSync(baseFolder, {
        log: logDir,
      });
      tree.forEach((filename) => {
        const fullPath = path.join(baseFolder, filename);
        const dirname = path.dirname(fullPath);
        const folder = realFolders[dirname] || {};
        realFolders[dirname] = folder;
        folder[fullPath] = true;
      });
    }
  });
  const dataFolders = {};
  // read all data starting from baseFolders
  baseFolders.forEach((baseFolder) => {
    Object.assign(dataFolders, readDataFolderTree(baseFolder, userDataDir));
  });

  console.log('');

  // for each real folder, check that every image/video exists
  // in data folder
  for (const [folderName, files] of Object.entries(realFolders)) {
    const dataFolder = dataFolders[folderName];
    if (!dataFolder) {
      // does this folder have any files?
      console.warn('no data for:', folderName);
    } else {
      const dataFiles = dataFolder.files;
      for (const filename of Object.keys(files)) {
        if (filters.isMediaExtension(filename)) {
          const fileInfo = dataFiles[filename];
          if (!fileInfo) {
            console.warn('no entry for:', filename);
          }
        } else if (filters.isArchive(filename)) {
          const archiveFolder = dataFolders[filename];
          if (!archiveFolder) {
            console.warn('no data for:', filename);
          } else {
            if (!archiveFolder.scannedTime) {
              console.warn('folder not scanned:', filename);
            } else {
              if (Object.keys(archiveFolder.files).length === 0) {
                console.warn('no files for archive:', filename);
                if (options.deleteFolderDataIfNoFilesForArchive) {
                  console.log('DELETE:', archiveFolder.baseFoldername, filename);
                  archiveFolder.deleteData();
                }
              }
            }
          }
        }
      }
    }
  }
}

function readDataFolderTree(folderPath, userDataDir) {
  logLine('read folder data:', folderPath);
  const folderData = new FolderData(folderPath, {
    readOnly: true,
    fs: fs,
    dataDir: userDataDir,
  });
  const folders = {};
  if (folderData.exists) {
    folders[folderPath] = folderData;
    const bins = separateFiles(folderData.files);
    for (const subFolderPath of Object.keys(bins.folders)) {
      Object.assign(folders, readDataFolderTree(subFolderPath, userDataDir));
    }
    for (const subFolderPath of Object.keys(bins.archives)) {
      Object.assign(folders, readDataFolderTree(subFolderPath, userDataDir));
    }
  }
  return folders;
}
