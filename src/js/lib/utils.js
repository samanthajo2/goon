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

// import * as fs from 'fs';
// import * as path from 'path';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import _ from 'lodash';

const driveRE = /^[A-Z]:[\\/]/i;
const uncRE = /^\/\/[^/]+\/[^/]+|\\\\[^\\]+\\[^\\]+/;
const backslashRE = /\\/g;
function urlFromFilename(filename) {
  // this smells
  if (filename.substr(0, 5).toLowerCase() === 'blob:') {
    return filename;
  }

  if (driveRE.test(filename) || uncRE.test(filename)) {
    return `file:///${filename.replace(/#/g, '%23').replace(/\?/g, '%3f')}`;
  }
  return filename.replace(backslashRE, '/').split('/').map(encodeURIComponent).join('/');
}

// const slashDriveRE = /^[\\/][A-Z]:[\\/]/i;
const hashToEndRE = /#.*$/;
const questionToEndRE = /\?.*$/;
function filenameFromUrl(url) {
  if (url.substr(0, 5).toLowerCase() === 'blob:') {
    throw new Error(`${url} is a blob`);
  }
  // HACK HACK HACK!
  // NOTE: at the moment we're only using this to convert thumbail URLs
  // otherwise we should really parse, find '#' and cut, find '?' and cut
  // decodeURIComponent the rest, or something like that.
  let filename = url;
  if (filename.startsWith('file:///') || filename.startsWith('file:\\\\\\')) {
    filename = filename.substring(8);
  }
  // I think this is safe because if this is a URL then there should only
  // be one ? as the rest got escaped.
  filename = filename.replace(hashToEndRE, '').replace(questionToEndRE, '');
  filename = decodeURIComponent(filename);
  return filename;
}

function resizeCanvasToDisplaySize(canvas, devicePixelRatio) {
  devicePixelRatio = devicePixelRatio || 1;
  devicePixelRatio = Math.max(1, devicePixelRatio);
  const width  = canvas.clientWidth  * devicePixelRatio | 0;
  const height = canvas.clientHeight * devicePixelRatio | 0;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    return true;
  }
  return false;
}

function getIndexToInsert(array, filename) {
  // switch to binary search
  let ndx;
  for (ndx = 0; ndx < array.length; ++ndx) {
    if (filename <= array[ndx].filename) {
      break;
    }
  }
  return ndx;
}

function px(v) {
  return `${v}px`;
}

function getActualFilenameCaseSensitive(filename) {
  if (!fs.existsSync(filename)) {
    throw new Error(`${filename} does not exist`);
  }
  return filename;
}

function getActualFilenameCaseInsensitiveImpl(filename) {
  const lcFilename = path.basename(filename).toLowerCase();
  // handles passing in `c:\\`
  if (!lcFilename) {
    return filename.toUpperCase();
  }

  const dirname = path.dirname(filename);
  let filenames;
  try {
    filenames = fs.readdirSync(dirname);
  } catch (e) {
    // we already verified the path exists above so if this
    // happens it means the OS won't let use get a listing (UNC root on windows)
    // so it's the best we can do
    return filename;
  }
  const matches = filenames.filter((name) => lcFilename === name.toLowerCase());
  if (!matches.length) {
    throw new Error(`${filename} does not exist`);
  }

  const realname = matches[0];
  if (dirname !== '.') {
    if (dirname.endsWith('/') || dirname.endsWith('\\')) {
      return path.join(dirname, realname);
    } else {
      return path.join(getActualFilenameCaseInsensitiveImpl(dirname), realname);
    }
  } else {
    return realname;
  }
}

function getActualFilenameCaseInsensitive(filename) {
  filename = filename.replace(/\\/g, '/');
  if (!fs.existsSync(filename)) {
    throw new Error(`${filename} does not exist`);
  }
  return getActualFilenameCaseInsensitiveImpl(filename);
}

function isFileInfoSame(oldInfo, newInfo) {
  return oldInfo.size === newInfo.size &&
         oldInfo.mtime === newInfo.mtime &&
         oldInfo.isDirectory === newInfo.isDirectory;
}

/**
 * @param {Object.<string, FileInfo>} oldFiles
 * @param {Object.<string, FileInfo>} newFiles
 * return true if objects are the same
 */

function areFilesSame(oldFiles, newFiles) {
  const newNames = Object.keys(newFiles);
  const oldNames = Object.keys(oldFiles);
  if (newNames.length !== oldNames.length) {
    return false;
  }
  const sortedNewNames = newNames.slice().sort();
  const sortedOldNames = oldNames.slice().sort();
  const numNames = sortedNewNames.length;
  for (let i = 0; i < numNames; ++i) {
    const oldName = sortedOldNames[i];
    const newName = sortedNewNames[i];
    if (oldName !== newName) {
      return false;
    }
    const oldInfo = oldFiles[oldName];
    const newInfo = newFiles[newName];
    if (!isFileInfoSame(oldInfo, newInfo)) {
      return false;
    }
  }
  return true;
}

function getDifferentFilenames(oldFiles, newFiles) {
  const oldNames = Object.keys(oldFiles);
  const newNames = Object.keys(newFiles);

  const removedNames = _.difference(oldNames, newNames);
  const addedNames = _.difference(newNames, oldNames);

  const sameNames = _.intersection(newNames, oldNames);

  const changedNames = sameNames.filter((name) => {
    const oldInfo = oldFiles[name];
    const newInfo = newFiles[name];
    return !isFileInfoSame(oldInfo, newInfo);
  });

  return {
    added: addedNames,
    removed: removedNames,
    changed: changedNames,
    same: _.difference(sameNames, changedNames),
  };
}

function getObjectsByKeys(objects, keys) {
  const obj = {};
  keys.forEach((key) => {
    obj[key] = objects[key];
  });
  return obj;
}

function euclideanModulo(n, m) {
  return ((n % m) + m) % m;
}

function createBasename(dataDir, prefix, filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(filePath, 'utf8');
  return path.join(dataDir, `${prefix}-${hash.digest('hex')}`);
}

// used to make some prefix a browser can use the prefx to reference
// a path to media
function dirsToPrefixMap(dirs) {
  const map = {};
  dirs.forEach((dir) => {
    map[dir] = createBasename('', 'folder', dir);
  });
  return map;
}

// We need to trap beacuse some paths will fail rather than just
// generate an error :(
function filterNonExistingDirs(dirs) {
  return dirs.filter((dir) => {
    try {
      const stat = fs.statSync(dir);
      return !!stat;
    } catch (e) {
      return false;
    }
  });
}

// PS: I understand this is not a good check. I should probably
// write a file as temp/ABC and try to open it as temp/abc
// but for now I don't care
const fsIsCaseSensitive = process.platform !== 'darwin' && !process.platform.startsWith('win');
const getActualFilename = fsIsCaseSensitive
  ? getActualFilenameCaseSensitive
  : getActualFilenameCaseInsensitive;

function removeChildFolders(folderNames) {
  const fullNames = folderNames.map((name) => path.normalize(path.resolve(name)));
  const filteredNames = [];
  for (const fullName of fullNames) {
    let parentExists = false;
    for (let i = 0; i < filteredNames.length; ++i) {
      const filteredName = filteredNames[i];
      if (filteredName.startsWith(fullName)) {
        // fullName is parent
        filteredNames[i] = fullName;
        parentExists = true;
        break;
      } else if (fullName.startsWith(filteredName)) {
        // filteredName is parent
        parentExists = true;
        break;
      }
    }
    if (!parentExists) {
      filteredNames.push(fullName);
    }
  }
  return filteredNames;
}

function fileExistsSync(filename) {
  try {
    const stat = fs.statSync(filename);
    return !!stat;
  } catch (e) {
    return false;
  }
}

export {
  areFilesSame,
  createBasename,
  dirsToPrefixMap,
  euclideanModulo,
  fileExistsSync,
  filenameFromUrl,
  filterNonExistingDirs,
  getActualFilename,
  getDifferentFilenames,
  getIndexToInsert,
  getObjectsByKeys,
  isFileInfoSame,
  px,
  removeChildFolders,
  resizeCanvasToDisplaySize,
  urlFromFilename,
};

