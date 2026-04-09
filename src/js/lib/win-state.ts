import { SortMode } from '../pages/view/folder-state-helper.js';
import { GridMode } from '../pages/view/grid-modes.js';

// State of main UI inside of window (the side bar vs the VPairs but not the splits in the VPairs)
// This is saved in the window state and restored when the window is opened
export type WinState = {
  showUI: number,
  rotateMode: number,
  thumbnailZoom: number,
  sortMode: SortMode
  gridMode: GridMode,
  splitPosition: 0.2,
  splitStartPosition: 0.2,
};
