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

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChannelStream } from '../../../lib/electron-renderer-imports.js';
import { throttle } from '../../../lib/utils.js';
import FolderDB, { DBFoldersByPath } from '../folder-db.js';
import FolderFilter from '../folder-filter.js';
import type { FilterFn } from '../folder-filter.js';
import { FolderStateHelper, FolderStateRoot, SortMode } from '../folder-state-helper.js';

export function useFolderPipeline({
  thumberStream,
  compositeFilter,
  sortMode,
  showEmpty,
}: {
  thumberStream: ChannelStream | null;
  compositeFilter: FilterFn;
  sortMode: SortMode;
  showEmpty: boolean;
}): {
  root: FolderStateRoot;
  totalFiles: number;
  folderDB: FolderDB;
} {
  const [root, setRoot] = useState<FolderStateRoot>(() => FolderStateHelper.createRoot(sortMode));
  const [totalFiles, setTotalFiles] = useState(0);

  const folderDBRef = useRef(new FolderDB());
  const folderFilterRef = useRef(new FolderFilter());
  const newRootRef = useRef(FolderStateHelper.createRoot(sortMode));

  // Keep mutable values in refs so stable callbacks can read the latest
  const sortModeRef = useRef(sortMode);
  sortModeRef.current = sortMode;
  const showEmptyRef = useRef(showEmpty);
  showEmptyRef.current = showEmpty;
  const compositeFilterRef = useRef(compositeFilter);
  compositeFilterRef.current = compositeFilter;

  // Throttled root update — stable across renders
  const throttledSetRootRef = useRef(throttle(() => {
    setRoot({ ...newRootRef.current });
  }, 150));

  // Recreate the root and replay all DB data through the filter pipeline
  const rerunFilter = useCallback(() => {
    newRootRef.current = FolderStateHelper.createRoot(sortModeRef.current);
    // Intentionally synchronous: we want the UI to show an empty root
    // immediately (before sendAll re-populates it) so the old stale folders
    // don't flash at the new sort order. The double-render is acceptable here.
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setRoot({ ...newRootRef.current });
    folderDBRef.current.sendAll();
  }, []);

  // Set up the FolderDB → FolderFilter → FolderStateHelper pipeline (once)
  useEffect(() => {
    const folderDB = folderDBRef.current;
    const folderFilter = folderFilterRef.current;
    let filterProcessQueued = false;

    const processFolderFilter = (): void => {
      filterProcessQueued = false;
      if (folderFilter.process()) {
        // processFolderFilter and queueFolderFilterProcess are mutually recursive.
        // queueFolderFilterProcess is declared below, but both are const arrow
        // functions inside the same closure — by the time either is called
        // (via process.nextTick), both are fully initialised. Safe at runtime.
        queueFolderFilterProcess(); // eslint-disable-line @typescript-eslint/no-use-before-define
      }
    };

    const queueFolderFilterProcess = (): void => {
      if (!filterProcessQueued) {
        filterProcessQueued = true;
        process.nextTick(processFolderFilter);
      }
    };

    const addFilesToFolderStateHelper = (folders: DBFoldersByPath): void => {
      FolderStateHelper.updateFolders(newRootRef.current, folders as never, { showEmpty: showEmptyRef.current });
      throttledSetRootRef.current();
    };

    const addFilesToFolderFilter = (folders: DBFoldersByPath): void => {
      setTotalFiles(folderDB.totalFiles);
      folderFilter.updateFiles(folders);
    };

    folderDB.on('updateFiles', addFilesToFolderFilter);
    folderFilter.on('updateFiles', addFilesToFolderStateHelper);
    folderFilter.on('pending', queueFolderFilterProcess);

    // Apply the initial filter and kick off the pipeline
    folderFilter.setFilter(compositeFilterRef.current);
    rerunFilter();

    return () => {
      folderDB.removeListener('updateFiles', addFilesToFolderFilter);
      folderFilter.removeListener('updateFiles', addFilesToFolderStateHelper);
      folderFilter.removeListener('pending', queueFolderFilterProcess);
    };
  // folderDBRef, folderFilterRef, throttledSetRootRef, showEmptyRef are stable
  // refs whose .current values are read inside the callbacks — they never
  // change identity between renders, so [] is correct here.
  // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, []);

  // Subscribe to thumberStream when it becomes available
  useEffect(() => {
    if (!thumberStream) return;
    const addFilesToFolderDB = (folders: DBFoldersByPath): void => {
      folderDBRef.current.updateFiles(folders as never);
    };
    thumberStream.on('updateFiles', addFilesToFolderDB);
    return () => {
      thumberStream.removeListener('updateFiles', addFilesToFolderDB);
    };
  }, [thumberStream]);

  // Re-apply the filter and replay when the composite filter changes
  useEffect(() => {
    folderFilterRef.current.setFilter(compositeFilter);
    rerunFilter();
  }, [compositeFilter, rerunFilter]);

  // Rerun when sort order or showEmpty changes (filter stays the same)
  useEffect(() => {
    rerunFilter();
  }, [sortMode, showEmpty, rerunFilter]);

  return { root, totalFiles, folderDB: folderDBRef.current };
}
