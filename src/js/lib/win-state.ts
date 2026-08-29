import { SortMode } from '../pages/view/folder-state-helper.js';
import { GridMode } from '../pages/view/grid-modes.js';

// showUI is a two-bit field. toggleUI cycles through all four combinations;
// toggleToolbar and toggleSidePanel flip one bit each. Main reads these too, to
// keep the View menu's checkmarks in step with the focused window.
export const SHOW_UI_TOOLBAR = 1;
export const SHOW_UI_SIDE_PANEL = 2;
export const DEFAULT_SHOW_UI = SHOW_UI_TOOLBAR | SHOW_UI_SIDE_PANEL;

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
