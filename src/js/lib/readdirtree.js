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

import fs from 'fs';
import path from 'path';

function readDirTreeSync(filePath, options) {
  options = options || {};
  if (options.log) {
    options.log(filePath);
  }

  let filter = options.filter;
  if (filter === undefined) {
    filter = () => true;
  } else if (filter instanceof RegExp) {
    filter = ((filt) => (filename) => filt.test(filename))(filter);
  }

  function callFilter(filename) {
    return filter(filename, filePath, fs.statSync(path.join(filePath, filename)).isDirectory());
  }

  let fileNames = fs.readdirSync(filePath).filter(callFilter);

  const subdirFilenames = [];
  fileNames = fileNames.filter((fileName) => {
    const subdirFileName = path.join(filePath, fileName);
    try {
      const stat = fs.statSync(subdirFileName);
      if (stat.isDirectory()) {
        subdirFilenames.push(readDirTreeSync(subdirFileName, options).map((subFileName) => path.join(fileName, subFileName)));
      }
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  });

  subdirFilenames.forEach((subNames) => {
    fileNames = fileNames.concat(subNames);
  });

  return fileNames;
}

function globToRegex(glob) {
  return glob
    .replace(/\//g, '\\/')
    .replace(/\./g, '\\.')
    .replace(/\?/g, '.')
    .replace(/\*/g, '.*?');
}

function makeIgnoreFunc(ignore) {
  let negate = false;
  let mustBeDir = false;
  if (ignore.substr(0, 1) === '!') {
    negate = true;
    ignore = ignore.substr(1);
  }
  if (ignore.substr(0, 1) === '/') {
    ignore = `^\\/${ignore.substr(1)}`;
  } else {
    ignore = `\\/${ignore}`;
  }
  if (ignore.substr(-1) === '/') {
    mustBeDir = true;
  }
  ignore = globToRegex(ignore);
  if (!mustBeDir && ignore.substr(0, 1) !== '^') {
    ignore += '$';
  }
  const re = new RegExp(ignore);

  return (filename, filePath, isDir) => {
    filename = `/${filename}${isDir ? '/' : ''}`;
    let ig = !re.test(filename);
    if (negate) {
      ig = !ig;
    }
    return ig;
  };
}

function makeIgnoreFilter(ignores) {
  if (!ignores) {
    return () => true;
  }

  const ignoreFuncs = ignores.map(makeIgnoreFunc);

  return (nativeFilename, filePath, isDir) => {
    const filename = nativeFilename.replace(/\\/g, '/');
    for (let ii = 0; ii < ignoreFuncs.length; ++ii) {
      const ignoreFunc = ignoreFuncs[ii];
      const result = ignoreFunc(filename, filePath, isDir);
      if (!result) {
        return false;
      }
    }
    return true;
  };
}

export {
  makeIgnoreFilter,
  readDirTreeSync as sync,
};

