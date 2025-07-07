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

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const driveRE = /^[A-Z]:[\\/]/i;
const uncRE = /^\/\/[^/]+\/[^/]+|\\\\[^\\]+\\[^\\]+/;
const backslashRE = /\\/g;
function urlFromFilename(filename: string): string {
  // this smells
  if (filename.substring(0, 5).toLowerCase() === 'blob:') {
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
function filenameFromUrl(url: string): string {
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

function resizeCanvasToDisplaySize(canvas: HTMLCanvasElement, devicePixelRatio: number) {
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

function getIndexToInsert(array: {filename: string}[], filename: string) {
  // switch to binary search
  let ndx;
  for (ndx = 0; ndx < array.length; ++ndx) {
    if (filename <= array[ndx].filename) {
      break;
    }
  }
  return ndx;
}

function px(v: number) {
  return `${v}px`;
}

function getActualFilenameCaseSensitive(filename: string): string {
  if (!fs.existsSync(filename)) {
    throw new Error(`${filename} does not exist`);
  }
  return filename;
}

function getActualFilenameCaseInsensitiveImpl(filename: string): string {
  const lcFilename = path.basename(filename).toLowerCase();
  // handles passing in `c:\\`
  if (!lcFilename) {
    return filename.toUpperCase();
  }

  const dirname = path.dirname(filename);
  let filenames;
  try {
    filenames = fs.readdirSync(dirname);
  } catch {
    // we already verified the path exists above so if this
    // happens it means the OS won't let use get a listing (UNC root on windows)
    // so it's the best we can do
    return filename;
  }
  const matches = filenames.filter((name) => lcFilename === name.toLowerCase());
  if (!matches.length) {
    throw new Error(`${filename} does not exist`);
  }

  const realName = matches[0];
  if (dirname !== '.') {
    if (dirname.endsWith('/') || dirname.endsWith('\\')) {
      return path.join(dirname, realName);
    } else {
      return path.join(getActualFilenameCaseInsensitiveImpl(dirname), realName);
    }
  } else {
    return realName;
  }
}

function getActualFilenameCaseInsensitive(filename: string): string {
  filename = filename.replace(/\\/g, '/');
  if (!fs.existsSync(filename)) {
    throw new Error(`${filename} does not exist`);
  }
  return getActualFilenameCaseInsensitiveImpl(filename);
}

// This is local to limit what data is expected in the functions below.
type FileInfo = {
  size: number,
  mtime: number,
  isDirectory: boolean,
};

function isFileInfoSame(oldInfo: FileInfo, newInfo: FileInfo) {
  return oldInfo.size === newInfo.size &&
         oldInfo.mtime === newInfo.mtime &&
         oldInfo.isDirectory === newInfo.isDirectory;
}

/**
 * return true if objects are the same
 */
function areFilesSame(oldFiles: Record<string, FileInfo>, newFiles: Record<string, FileInfo>): boolean {
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

function getDifferentFilenames(oldFiles: Record<string, FileInfo>, newFiles: Record<string, FileInfo>) {
  const oldNames = new Set(Object.keys(oldFiles));
  const newNames = new Set(Object.keys(newFiles));

  const removedNames = [...oldNames.difference(newNames)];
  const addedNames = [...newNames.difference(oldNames)];

  const sameNames = newNames.intersection(oldNames);

  const changedNames = new Set(sameNames.keys().filter((name) => {
    const oldInfo = oldFiles[name];
    const newInfo = newFiles[name];
    return !isFileInfoSame(oldInfo, newInfo);
  }));

  return {
    added: addedNames,
    removed: removedNames,
    changed: [...changedNames],
    same: [...sameNames.difference(changedNames)],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getObjectsByKeys<T extends { [key: string]: any }>(
  src: T,
  keys: readonly string[]
): T {
  return Object.fromEntries(keys.map(k => [k, src[k]])) as T;
}

function euclideanModulo(n: number, m: number) {
  return ((n % m) + m) % m;
}

function createBasename(dataDir: string, prefix: string, filePath: string) {
  const hash = crypto.createHash('sha256');
  hash.update(filePath, 'utf8');
  return path.join(dataDir, `${prefix}-${hash.digest('hex')}`);
}

// used to make some prefix a browser can use the prefix to reference
// a path to media
function dirsToPrefixMap(dirs: string[]) {
  const map: { [key: string]: string} = {};
  dirs.forEach((dir) => {
    map[dir] = createBasename('', 'folder', dir);
  });
  return map;
}

// We need to trap because some paths will fail rather than just
// generate an error :(
function filterNonExistingDirs(dirs: string[]) {
  return dirs.filter((dir) => {
    try {
      const stat = fs.statSync(dir);
      return !!stat;
    } catch {
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

export function removeChildFolders(folderNames: string[]) {
  const fullNames = folderNames.map((name) => path.normalize(path.resolve(name)));
  const filteredNames: string[] = [];
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

export function fileExistsSync(filename: string) {
  try {
    const stat = fs.statSync(filename);
    return !!stat;
  } catch {
    return false;
  }
}

export function cloneDeep<T>(src: T): T {
  return JSON.parse(JSON.stringify(src));
}

export function readUTF8FileSync(filename: string): string {
  return fs.readFileSync(filename, {encoding: 'utf8'});
}

export function range<T>(count: number, fn: (i: number) => T): T[] {
  const arr: T[] = [];
  for (let i = 0; i < count; ++i) {
    arr.push(fn(i));
  }
  return arr;
}

export {
  areFilesSame,
  createBasename,
  dirsToPrefixMap,
  euclideanModulo,
  filenameFromUrl,
  filterNonExistingDirs,
  getActualFilename,
  getDifferentFilenames,
  getIndexToInsert,
  getObjectsByKeys,
  isFileInfoSame,
  px,
  resizeCanvasToDisplaySize,
  urlFromFilename,
};

