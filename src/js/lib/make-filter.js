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

import moment from 'moment';
import {getOrientationInfo} from './rotatehelper';

const filterTable = {
  width:    { fn: makeWidthFilter,    type: 'width', },
  height:   { fn: makeHeightFilter,   type: 'height', },
  aspect:   { fn: makeAspectFilter,   type: 'aspect', },
  folder:   { fn: makeFolderFilter,   type: 'folder', },
  dir:      { fn: makeFolderFilter,   type: 'folder', },
  dirname:  { fn: makeFolderFilter,   type: 'folder', },
  filename: { fn: makeFilenameFilter, type: 'filename', },
  basename: { fn: makeFilenameFilter, type: 'filename', },
  date:     { fn: makeDateFilter,     type: 'date', },
  size:     { fn: makeSizeFilter,     type: 'size', },
  glob:     { fn: makeGlobFilter,     type: 'glob', },
  type:     { fn: makeTypeFilter,     type: 'type', },
  bad:      { fn: makeBadFilter,      type: 'bad', },
};

const somethingQuoteRE = /(.)"/g;

function unquoteHelper(m0, m1) {
  return (m1 === '\\') ? '"' : m1;
}

function unquote(str) {
  if (str.startsWith('"')) {
    str = str.substring(1);
  }
  str = str.replace(somethingQuoteRE, unquoteHelper);
  return str;
}

const spaceRE = /(?=\S)[^"\s]*(?:"[^\\"]*(?:\\[\s\S][^\\"]*)*"[^"\s]*)*/g;
const wordRE = /([a-z]+):(.*)/i;
const wordREFn = wordRE.exec.bind(wordRE);

function makeFilter(filterStr) {
  const parts = (filterStr.trim().match(spaceRE) || ['']).map(unquote);
  const wordMatches = parts.map(wordREFn);
  const filters = [];
  const errors = [];
  let currentGlob = [];
  const filterTypesUsed = {};

  function addResult(filterType, result) {
    if (result.error) {
      errors.push(result.error);
    } else {
      filterTypesUsed[filterType] = true;
      filters.push(result.filter);
    }
  }

  function addCurrentGlob() {
    if (currentGlob.length) {
      const str = currentGlob.join(' ');
      addResult('glob', str === '' ? makeAllPassFilter(str) :  makeGlobFilter(str));
      currentGlob = [];
    }
  }

  for (let i = 0; i < parts.length; ++i) {
    const part = parts[i];
    const match = wordMatches[i];
    if (match) {
      addCurrentGlob();
      const filterName = match[1];
      const filterArgs = match[2];
      const filterType = filterName.toLowerCase();
      const filterInfo = filterTable[filterType];
      if (filterInfo) {
        addResult(filterInfo.type, filterInfo.fn(filterArgs));
      } else {
        errors.push(`unknown filter type: ${filterName}`);
      }
    } else {
      currentGlob.push(part);
    }
  }

  addCurrentGlob();

  if (errors.length) {
    return {
      error: errors.join(' '),
      filter: allPass,
    };
  }

  if (filters.length === 0) {
    return {
      filter: allPass,
      filterTypesUsed,
    };
  }

  if (filters.length === 1) {
    return {
      filter: filters[0],
      filterTypesUsed,
    };
  }

  return {
    filter: makeCompositeFilter(filters),
    filterTypesUsed,
  };
}

function allPass() {
  return true;
}

function makeAllPassFilter() {
  return {
    filter: allPass,
  };
}

function makeCompositeFilter(filters) {
  return (filename, fileInfo) => {
    for (const filter of filters) {
      if (!filter(filename, fileInfo)) {
        return false;
      }
    }
    return true;
  };
}

const expressionPartsRE = /([!><=]+)(\d*(?:\.\d*|))(.*)/;
const whitespaceRE = / \t\n/g;
const expressionFnTable = {
  '>':   (a, b) => a > b,
  '>=':  (a, b) => a >= b,
  '<':   (a, b) => a < b,
  '<=':  (a, b) => a <= b,
  '=':   (a, b) => a === b,
  '==':  (a, b) => a === b,
  '!=':  (a, b) => a !== b,
  '!==': (a, b) => a !== b,
};
const suffixMultiplierTable = {
  'b': 1,
  'k': 1024,
  'kb': 1024,
  'm': 1024 * 1024,
  'mb': 1024 * 1024,
  'g': 1024 * 1024 * 1024,
  'gb': 1024 * 1024 * 1024,
  't': 1024 * 1024 * 1024 * 1024,
  'tb': 1024 * 1024 * 1024 * 1024,
  'e': 1024 * 1024 * 1024 * 1024 * 1024,
  'eb': 1024 * 1024 * 1024 * 1024 * 1024,
  'p': 1024 * 1024 * 1024 * 1024 * 1024 * 1024,
  'pb': 1024 * 1024 * 1024 * 1024 * 1024 * 1024,
};
function makeExpressionFn(str) {
  // >
  // >=
  // <
  // <=
  // =
  // ==
  // k, m, g, b, kb, mb, gb
  // a/b?
  const parts = expressionPartsRE.exec(str.replace(whitespaceRE, ''));
  if (!parts) {
    return {
      filter: allPass,
      error: `unknown expression: ${str}`,
    };
  }
  const [, expression, number, suffix] = parts;
  const expressionFn = expressionFnTable[expression];
  if (!expressionFn) {
    return {
      filter: allPass,
      error: `unknown expression: ${expression}`,
    };
  }

  let multiplier = 1;
  if (suffix.length) {
    multiplier = suffixMultiplierTable[suffix.toLowerCase()];
    if (!multiplier) {
      return {
        filter: allPass,
        error: `unknonw suffix: ${suffix}`,
      };
    }
  }

  const amount = number * multiplier;
  return {
    filter: (a) => expressionFn(a, amount),
  };
}

// const globCharsRE = /[*?{}]/;
const globCharsRE = /[*?]/;
function makeGlob(str) {
  str = str.toLowerCase();
  if (!globCharsRE.test(str)) {
    return {
      filter: (v) => v.indexOf(str) >= 0,
    };
  }
  let re;
  try {
    str = str.replace(/\*/g, '.*');
    re = new RegExp(`[\\/]${str}`);
  } catch (e) {
    return {
      error: e.toString(),
      filter: allPass,
    };
  }

  return {
    filter: (v) => re.test(v),
  };
}

function makeGlobFilter(str) {
  const {error, filter} = makeGlob(str);
  return {
    error,
    filter: (filename, fileInfo) => filter(fileInfo.lowercaseName),
  };
}

function makeFolderFilter(str) {
  const {error, filter} = makeGlob(str);
  return {
    error,
    filter: (filename, fileInfo) => filter(fileInfo.folderName),
  };
}

function makeFilenameFilter(str) {
  const {error, filter} = makeGlob(str);
  return {
    error,
    filter: (filename, fileInfo) => filter(fileInfo.baseName),
  };
}

function makeTypeFilter(str) {
  const {error, filter} = makeGlob(str);
  return {
    error,
    filter: (filename, fileInfo) => filter(fileInfo.type),
  };
}

function makeWidthFilter(str) {
  const {error, filter} = makeExpressionFn(str);
  return {
    error,
    filter: (filename, fileInfo) => {
      const info = getOrientationInfo(fileInfo, fileInfo.orientation);
      return info.width && filter(info.width);
    },
  };
}

function makeHeightFilter(str) {
  const {error, filter} = makeExpressionFn(str);
  return {
    error,
    filter: (filename, fileInfo) => {
      const info = getOrientationInfo(fileInfo, fileInfo.orientation);
      return info.height && filter(info.height);
    },
  };
}

function makeSizeFilter(str) {
  const {error, filter} = makeExpressionFn(str);
  return {
    error,
    filter: (filename, fileInfo) => fileInfo.size && filter(fileInfo.size),
  };
}

function makeAspectFilter(str) {
  str = str.replace('landscape', '>1').replace('portrait', '<1');
  const {error, filter} = makeExpressionFn(str);
  return {
    error,
    filter: (filename, fileInfo) => {
      if (!fileInfo.width || !fileInfo.height) {
        return false;
      }
      const info = getOrientationInfo(fileInfo, fileInfo.orientation);
      const aspect = info.width / info.height;
      return filter(aspect);
    },
  };
}

function goodFilter(filename, fileInfo) {
  return !fileInfo.bad;
}

function badFilter(filename, fileInfo) {
  return fileInfo.bad;
}

function makeBadFilter(/* str */) {
  return {
    filter: badFilter,
  };
}

const dateExpressionPartsRE = /([!<>=]+)(.*)/;
function makeDateFilter(str) {
  const parts = dateExpressionPartsRE.exec(str.replace(whitespaceRE, ''));
  if (!parts) {
    return {
      filter: allPass,
      error: `unknown expression: ${str}`,
    };
  }
  const [, expression, dateStr] = parts;
  const expressionFn = expressionFnTable[expression];
  if (!expressionFn) {
    return {
      filter: allPass,
      error: `unknown expression: ${expression}`,
    };
  }

  const date = moment(dateStr, 'YYYY-MM-DD HH:MM:SS');
  if (!date.isValid()) {
    return {
      error: `invalid date: ${dateStr}`,
      filter: allPass,
    };
  }
  const amount = date.valueOf();
  return {
    filter: (filename, fileInfo) => expressionFn(fileInfo.mtime, amount),
  };
}

export {
  makeCompositeFilter,
  badFilter,
  goodFilter,
  makeFilter,
};
