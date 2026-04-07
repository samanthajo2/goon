/*
Copyright 2024 SamanthaJo

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import { useState, useRef, useCallback } from 'react';
import { makeFilter } from '../../../lib/make-filter';
import { Preferences } from '../../prefs/default-prefs';
import type { FilterFn } from '../folder-filter';
import type { DBFileInfo } from '../folder-db';

const passAll: FilterFn = () => true;

export function useFilter(prefs: Partial<Preferences>): {
  filter: string;
  filterError: string;
  userFilterFn: FilterFn;
  filterShowBad: boolean;
  filterSmallImages: boolean;
  haveBadFilter: boolean;
  handleUpdateFilter: (filterStr: string) => void;
  filterInputFocused: () => void;
  filterInputBlurred: () => void;
  isFilterInputActive: () => boolean;
} {
  const [filter, setFilter] = useState('');
  const [filterError, setFilterError] = useState('');
  const [userFilterFn, setUserFilterFn] = useState<FilterFn>(() => passAll);
  const [haveBadFilter, setHaveBadFilter] = useState(false);
  const filterInputActiveRef = useRef(false);

  const filterShowBad = !!(prefs.misc?.showBad || haveBadFilter);
  const filterSmallImages = !!(prefs.misc?.filterSmallImages);

  const handleUpdateFilter = useCallback((filterStr: string) => {
    const result = makeFilter(filterStr);
    setFilter(filterStr);
    setFilterError(result.error ?? '');
    if (!result.error) {
      setHaveBadFilter(!!(result.filterTypesUsed?.bad));
      // Wrap in arrow so useState stores the function itself, not its return value
      setUserFilterFn(() => result.filter as FilterFn);
    }
  }, []);

  const filterInputFocused = useCallback(() => { filterInputActiveRef.current = true; }, []);
  const filterInputBlurred = useCallback(() => { filterInputActiveRef.current = false; }, []);
  const isFilterInputActive = useCallback(() => filterInputActiveRef.current, []);

  return {
    filter,
    filterError,
    userFilterFn,
    filterShowBad,
    filterSmallImages,
    haveBadFilter,
    handleUpdateFilter,
    filterInputFocused,
    filterInputBlurred,
    isFilterInputActive,
  };
}

// Minimum dimension sizes used by the small-images filter.
// Duplicated here so the filter function can be self-contained.
const g_minSizes: Record<string, number> = {
  image: 256,
  'image/gif': 128,
  video: 128,
};

export function makeSmallDimensionsFilter(filterSmallImages: boolean): FilterFn {
  if (!filterSmallImages) return passAll;
  return (_filename: string, fileInfo: DBFileInfo): boolean => {
    let minSize = g_minSizes[fileInfo.type];
    if (!minSize) {
      if (!fileInfo.type) return true;
      const ndx = fileInfo.type.indexOf('/');
      if (ndx >= 0) {
        minSize = g_minSizes[fileInfo.type.substring(0, ndx)];
        if (!minSize) return true;
      } else {
        return true;
      }
    }
    const tooSmall =
      (fileInfo.width && fileInfo.width < minSize) ||
      (fileInfo.height && fileInfo.height < minSize);
    return !tooSmall;
  };
}

export function makeGoodFilter(filterShowBad: boolean): FilterFn {
  if (filterShowBad) return passAll;
  return (_filename: string, fileInfo: DBFileInfo): boolean => !fileInfo.bad;
}
