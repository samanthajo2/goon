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

import {getOrientationInfo} from './rotatehelper.js';
import { DBFileInfo } from '../pages/view/folder-db.js';

type FilterTableEntry = {
  fn: (str: string) => { filter: FilterFn, error?: string | undefined };
  type: FilterType;
};
const filterTable: Record<string, FilterTableEntry> = {
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
  length:   { fn: makeDurationFilter, type: 'duration', },
  duration: { fn: makeDurationFilter, type: 'duration', },
  glob:     { fn: makeGlobFilter,     type: 'glob', },
  type:     { fn: makeTypeFilter,     type: 'type', },
  bad:      { fn: makeBadFilter,      type: 'bad', },
} as const;
type FilterType = keyof typeof filterTable;
type FilterFn = (filename: string, fileInfo: DBFileInfo) => boolean;

const somethingQuoteRE = /(.)"/g;

function unquoteHelper(m0: string, m1: string) {
  return (m1 === '\\') ? '"' : m1;
}

function unquote(str: string) {
  if (str.startsWith('"')) {
    str = str.substring(1);
  }
  str = str.replace(somethingQuoteRE, unquoteHelper);
  return str;
}

const spaceRE = /(?=\S)[^"\s]*(?:"[^\\"]*(?:\\[\s\S][^\\"]*)*"[^"\s]*)*/g;
const wordRE = /([a-z]+):(.*)/i;
const wordREFn = wordRE.exec.bind(wordRE);

function makeFilter(filterStr: string) {
  const parts = (filterStr.trim().match(spaceRE) || ['']).map(unquote);
  const wordMatches = parts.map(wordREFn);
  const filters: FilterFn[] = [];
  const errors = [];
  let currentGlob: string[] = [];
  const filterTypesUsed: { [key in FilterType]?: boolean } = {};

  function addResult(filterType: FilterType, result: { filter: FilterFn, error?: string }) {
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
      addResult('glob', str === '' ? makeAllPassFilter() : makeGlobFilter(str));
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
      const filterInfo: FilterTableEntry = filterTable[filterType as FilterType];
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

function makeCompositeFilter(filters: FilterFn[]) {
  return (filename: string, fileInfo: DBFileInfo) => {
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
  '>':   (a: number, b: number) => a > b,
  '>=':  (a: number, b: number) => a >= b,
  '<':   (a: number, b: number) => a < b,
  '<=':  (a: number, b: number) => a <= b,
  '=':   (a: number, b: number) => a === b,
  '==':  (a: number, b: number) => a === b,
  '!=':  (a: number, b: number) => a !== b,
  '!==': (a: number, b: number) => a !== b,
} as const;
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
} as const;
function makeExpressionFn(str: string) {
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
  const expressionFn = expressionFnTable[expression as keyof typeof expressionFnTable];
  if (!expressionFn) {
    return {
      filter: allPass,
      error: `unknown expression: ${expression}`,
    };
  }

  let multiplier = 1;
  if (suffix.length) {
    multiplier = suffixMultiplierTable[suffix.toLowerCase() as keyof typeof suffixMultiplierTable];
    if (!multiplier) {
      return {
        filter: allPass,
        error: `unknown suffix: ${suffix}`,
      };
    }
  }

  const amount = parseFloat(number) * multiplier;
  return {
    filter: (a: number) => expressionFn(a, amount),
  };
}

// const globCharsRE = /[*?{}]/;
const globCharsRE = /[*?]/;
function makeGlob(str: string) {
  str = str.toLowerCase();
  if (!globCharsRE.test(str)) {
    return {
      filter: (v: string) => v.indexOf(str) >= 0,
    };
  }
  let re;
  try {
    str = str.replace(/\*/g, '.*');
    re = new RegExp(`[\\/]${str}`);
  } catch (e) {
    return {
      error: e?.toString(),
      filter: allPass,
    };
  }

  return {
    filter: (v: string) => re.test(v),
  };
}

function makeGlobFilter(str: string) {
  const {error, filter} = makeGlob(str);
  return {
    error,
    filter: (filename: string, fileInfo: DBFileInfo) => filter(fileInfo.lowercaseName),
  };
}

function makeFolderFilter(str: string) {
  const {error, filter} = makeGlob(str);
  return {
    error,
    filter: (filename: string, fileInfo: DBFileInfo) => filter(fileInfo.folderName),
  };
}

function makeFilenameFilter(str: string) {
  const {error, filter} = makeGlob(str);
  return {
    error,
    filter: (filename: string, fileInfo: DBFileInfo) => filter(fileInfo.baseName),
  };
}

function makeTypeFilter(str: string) {
  const {error, filter} = makeGlob(str);
  return {
    error,
    filter: (filename: string, fileInfo: DBFileInfo) => filter(fileInfo.type),
  };
}

function makeWidthFilter(str: string) {
  const {error, filter} = makeExpressionFn(str);
  return {
    error,
    filter: (filename: string, fileInfo: DBFileInfo) => {
      const info = getOrientationInfo(fileInfo, fileInfo.orientation);
      return info.width !== 0 && filter(info.width);
    },
  };
}

function makeHeightFilter(str: string) {
  const {error, filter} = makeExpressionFn(str);
  return {
    error,
    filter: (filename: string, fileInfo: DBFileInfo) => {
      const info = getOrientationInfo(fileInfo, fileInfo.orientation);
      return info.height !== 0 && filter(info.height);
    },
  };
}

function makeSizeFilter(str: string) {
  const {error, filter} = makeExpressionFn(str);
  return {
    error,
    filter: (filename: string, fileInfo: DBFileInfo) => fileInfo.size !== 0 && filter(fileInfo.size),
  };
}

// Parse a duration into seconds. Returns null if invalid.
//
// Accepted forms (case-insensitive):
//   bare number        -> seconds            (90        -> 90)
//   unit-suffixed       -> h/m/s summed       (3m        -> 180, 1m2s -> 62, 1.5h -> 5400)
//   clock (colons)      -> right-aligned to seconds by default
//                          (1:2 / 1:02        -> 62,  1:2:3 -> 3723)
//   clock + unit suffix -> the suffix sets the unit of the rightmost part,
//                          each part to its left is one unit higher
//                          (1:2s -> 62,  1:2m -> 3720 i.e. 1h2m)
//
// Mixed/repeated units are treated leniently by summing (1m2m -> 180, 1s2m -> 121).
function parseDuration(str: string): number | null {
  const s = str.trim().toLowerCase();
  if (s === '') return null;

  const unitSeconds = [1, 60, 3600]; // s, m, h

  if (s.includes(':')) {
    // Clock notation. An optional trailing h/m/s sets the rightmost part's unit.
    let base = 0;
    let body = s;
    const last = s[s.length - 1];
    if (last === 's' || last === 'm' || last === 'h') {
      base = last === 'h' ? 2 : last === 'm' ? 1 : 0;
      body = s.slice(0, -1);
    }
    const parts = body.split(':');
    let total = 0;
    let unit = unitSeconds[base];
    for (let i = parts.length - 1; i >= 0; --i) {
      if (!/^\d+(?:\.\d+)?$/.test(parts[i])) return null;
      total += parseFloat(parts[i]) * unit;
      unit *= 60;
    }
    return total;
  }

  // Bare number = seconds.
  if (/^\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);

  // One or more <number><h|m|s> tokens, summed.
  if (!/^(?:\d+(?:\.\d+)?[hms])+$/.test(s)) return null;
  const mult: Record<string, number> = { h: 3600, m: 60, s: 1 };
  const tokenRE = /(\d+(?:\.\d+)?)([hms])/g;
  let total = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRE.exec(s)) !== null) {
    total += parseFloat(m[1]) * mult[m[2]];
  }
  return total;
}

const durationExpressionRE = /^([!<>=]+)(.*)$/;
function makeDurationFilter(str: string) {
  const parts = durationExpressionRE.exec(str.trim());
  if (!parts) {
    return { filter: allPass, error: `unknown expression: ${str}` };
  }
  const [, expression, valueStr] = parts;
  const expressionFn = expressionFnTable[expression as keyof typeof expressionFnTable];
  if (!expressionFn) {
    return { filter: allPass, error: `unknown expression: ${expression}` };
  }
  const seconds = parseDuration(valueStr);
  if (seconds === null) {
    return { filter: allPass, error: `invalid duration: ${valueStr}` };
  }
  // Images (and anything without a duration) count as length 0.
  return {
    filter: (filename: string, fileInfo: DBFileInfo) => expressionFn(fileInfo.duration ?? 0, seconds),
  };
}

function makeAspectFilter(str: string) {
  str = str.replace('landscape', '>1').replace('portrait', '<1');
  const {error, filter} = makeExpressionFn(str);
  return {
    error,
    filter: (filename: string, fileInfo: DBFileInfo) => {
      if (!fileInfo.width || !fileInfo.height) {
        return false;
      }
      const info = getOrientationInfo(fileInfo, fileInfo.orientation);
      const aspect = info.width / info.height;
      return filter(aspect);
    },
  };
}

function goodFilter(filename: string, fileInfo: DBFileInfo) {
  return !fileInfo.bad;
}

function badFilter(filename: string, fileInfo: DBFileInfo) {
  return !!fileInfo.bad;
}

function makeBadFilter(/* str: string*/) {
  return {
    filter: badFilter,
  };
}

const dateExpressionPartsRE = /([!<>=]+)(.*)/;
function makeDateFilter(str: string) {
  const parts = dateExpressionPartsRE.exec(str.replace(whitespaceRE, ''));
  if (!parts) {
    return {
      filter: allPass,
      error: `unknown expression: ${str}`,
    };
  }
  const [, expression, dateStr] = parts;
  const expressionFn = expressionFnTable[expression as keyof typeof expressionFnTable];
  if (!expressionFn) {
    return {
      filter: allPass,
      error: `unknown expression: ${expression}`,
    };
  }

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return {
      error: `invalid date: ${dateStr}`,
      filter: allPass,
    };
  }
  const amount = date.getTime();
  return {
    filter: (filename: string, fileInfo: DBFileInfo) => expressionFn(fileInfo.mtime, amount),
  };
}

export {
  makeCompositeFilter,
  badFilter,
  goodFilter,
  makeFilter,
};
