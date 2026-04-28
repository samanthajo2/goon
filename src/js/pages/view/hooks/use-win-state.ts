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
import { debounce } from '../../../lib/utils.js';
import type { Platform } from '../../../lib/platform.js';
import type { SortMode } from '../folder-state-helper.js';
import type { GridMode } from '../grid-modes.js';

export type WinState = {
  showUI: number;
  rotateMode: number;
  thumbnailZoom: number;
  sortMode: SortMode;
  gridMode: GridMode;
  splitPosition: number;
  splitStartPosition: number;
};

const DEFAULT_WIN_STATE: WinState = {
  showUI: 3,
  rotateMode: 0,
  thumbnailZoom: 1,
  sortMode: 'sortPath',
  gridMode: 'columns',
  splitPosition: 0.2,
  splitStartPosition: 0.2,
};

type StartWinState = Partial<WinState>;

export function useWinState(platform: Platform, startWinState: StartWinState = {}): {
  winState: WinState;
  updateWinState: (patch: Partial<WinState> | ((prev: WinState) => Partial<WinState>), save?: boolean) => void;
} {
  const initial: WinState = {
    ...DEFAULT_WIN_STATE,
    ...startWinState,
    // If a saved splitPosition exists, use it as the starting position too
    splitStartPosition: startWinState.splitPosition ?? DEFAULT_WIN_STATE.splitStartPosition,
  };

  const [winState, setWinState] = useState<WinState>(initial);

  // Holds the latest WinState so the debounced save can read it without args
  const latestRef = useRef<WinState>(initial);

  // Stable debounced save — created once, reads from latestRef. The
  // `platform` arg is captured at hook-init time; in practice platform is
  // a stable reference for the lifetime of the component tree.
  const saveRef = useRef(debounce(() => {
    platform.saveWinState(latestRef.current);
  }, 250));

  const updateWinState = useCallback(
    (patch: Partial<WinState> | ((prev: WinState) => Partial<WinState>), save = true) => {
      setWinState((prev) => {
        const delta = typeof patch === 'function' ? patch(prev) : patch;
        const next = { ...prev, ...delta };
        if (save) {
          latestRef.current = next;
          saveRef.current();
        }
        return next;
      });
    },
    [],
  );

  return { winState, updateWinState };
}
