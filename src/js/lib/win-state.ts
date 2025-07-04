import { SortMode } from '../pages/view/folder-state-helper';
import { GridMode } from '../pages/view/grid-modes';

export type WinState = {
  showUI: number,
  rotateMode: number,
  thumbnailZoom: number,
  sortMode: SortMode
  gridMode: GridMode,
  splitPosition: 0.2,
  splitStartPosition: 0.2,
};
