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

import React from 'react';
import VirtualList, { VirtualListHandle } from '../../lib/ui/virtual-list.js';
import ResizeSensor from '../../lib/ui/resize-sensor.js';
import { getRotatedXY } from '../../lib/rotatehelper.js';
import ListenerManager from '../../lib/listener-manager.js';
import debug from '../../lib/debug.js';
import ForwardableEvent from '../../lib/forwardable-event.js';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher.js';
import { DBFileInfo } from './folder-db.js';
import Thumbnail from './thumbnail.js';
import ActionListener from '../../lib/action-listener.js';
import { px } from '../../lib/utils.js';
import gridModes, { GridMode } from './grid-modes.js';
import { setRAF } from '../../lib/wait.js';
import { FolderStateRoot, FolderStateFolder, SortInfo } from './folder-state-helper.js';
import { AppContext } from './contexts.js';
import { toggleSelection, shiftToggleSelection, selectEntries, clearSelection, SelectionEntry } from './selection-state.js';
import { getDragContext } from './drag-context.js';
import { isVirtualFolderKey } from '../thumber/virtual-folder-key.js';

let g_imageGridsRenderCount = 0;
let g_renderCount = 0;
const g_folderHeaderHeight = 30;

type ZoomFn = (v: number) => number;

type GridOptions = {
  padding: number;
  minColumnWidth: number;
};

type Options = {
  columnWidth: number;
  padding: number;
  maxSeekTime: number;
};

type WinState = {
  gridMode: GridMode;
  thumbnailZoom: number;
  showUI: number;
  rotateMode: number;
  sortMode: string;
};

export type ScrollAnchor = {
  folderIndex: number;
  fileIndex: number;
  offset?: number;
  folderName?: string;
  fileName?: string;
};

type FolderInfo = {
  key: string;
  count: number;
  name: string;
  folder: FolderStateFolder;
  height: number;
};

// Should pass this down to imagegrid
function computeFolderHeight(
  folder: FolderStateFolder,
  gridMode: GridMode,
  width: number,
  zoom: ZoomFn,
  options: GridOptions,
): number {
  if (!folder.files || folder.files.length === 0) {
    return 0;
  }
  const manager = gridModes.value(gridMode).helper(width, options);
  folder.files.forEach((file: SortInfo) => {
    const info = file.info;
    const thumbnail = info.thumbnail;
    manager.getPositionForElement(thumbnail.width, thumbnail.height);
  });
  return manager.height;
}

// Finds the first fully-visible thumbnail at or after `scrollTop`.
// "Fully visible" means the thumbnail's top edge is >= scrollTop (not clipped above).
// Returns {folderIndex, fileIndex} or null if nothing found.
//
// NOTE: ColumnManager places items in the shortest column, so y-values across
// insertion order are NOT monotonically increasing in multi-column layouts.
// We must scan all items in the folder and find the minimum y >= relScrollTop.
//
// `folders` must be an array of {folder} objects (same shape as this._folders).
export function findAnchorThumbnail(
  folders: FolderInfo[],
  gridMode: GridMode,
  width: number,
  zoomFn: ZoomFn,
  options: GridOptions,
  scrollTop: number,
): ScrollAnchor | null {
  let folderTop = 0;
  for (let fi = 0; fi < folders.length; fi++) {
    const folder = folders[fi].folder;
    const files = folder.files;
    const gridHeight = computeFolderHeight(folder, gridMode, width, zoomFn, options);
    const folderBottom = folderTop + g_folderHeaderHeight + gridHeight;

    if (folderBottom > scrollTop) {
      const relScrollTop = scrollTop - folderTop - g_folderHeaderHeight;
      const manager = gridModes.value(gridMode).helper(width, options);
      let bestTi = -1;
      let bestY = Infinity;
      // Allow 1px tolerance: browsers round fractional scrollTop values, which
      // can shift a thumbnail's top edge just above the viewport.
      const snapTolerance = 1;
      for (let ti = 0; ti < (files ? files.length : 0); ti++) {
        const thumbnail = (files[ti] as SortInfo).info.thumbnail;
        const pos = manager.getPositionForElement(thumbnail.width, thumbnail.height);
        if (pos.y >= relScrollTop - snapTolerance && pos.y < bestY) {
          bestY = pos.y;
          bestTi = ti;
        }
      }
      if (bestTi >= 0) {
        return { folderIndex: fi, fileIndex: bestTi };
      }
    }

    folderTop = folderBottom;
  }
  return null;
}

// Given a folder+file anchor, computes the absolute scrollTop such that the
// anchor thumbnail's top edge is at the top of the viewport.
export function computeThumbScrollTop(
  folders: FolderInfo[],
  gridMode: GridMode,
  width: number,
  zoomFn: ZoomFn,
  options: GridOptions,
  folderIndex: number,
  fileIndex: number,
): number {
  let top = 0;
  for (let fi = 0; fi < folderIndex; fi++) {
    top += g_folderHeaderHeight + computeFolderHeight(folders[fi].folder, gridMode, width, zoomFn, options);
  }
  top += g_folderHeaderHeight;

  const anchorFolder = folders[folderIndex].folder;
  const files = anchorFolder.files;
  if (!files || fileIndex < 0) {
    return top;
  }
  const manager = gridModes.value(gridMode).helper(width, options);
  for (let ti = 0; ti <= fileIndex && ti < files.length; ti++) {
    const thumbnail = (files[ti] as SortInfo).info.thumbnail;
    const pos = manager.getPositionForElement(thumbnail.width, thumbnail.height);
    if (ti === fileIndex) {
      top += pos.y;
    }
  }
  return top;
}

type ImageGridProps = {
  count: number;
  width: number;
  name: string;
  folder: FolderStateFolder;
  options: Options;
  gridMode: GridMode;
  scrollParent: (pos: number) => void;
  setCurrentView: () => void;
  currentImageIndex: number;
  zoom: ZoomFn;
  winState: WinState;
};

class ImageGrid extends React.Component<ImageGridProps, { dragOver: boolean }> {
  static contextType = AppContext;
  declare context: React.ContextType<typeof AppContext>;

  state = { dragOver: false };

  private _logger: ReturnType<typeof debug>;
  private grid!: HTMLDivElement;

  constructor(props: ImageGridProps) {
    super(props);
    this._logger = debug('ImageGrid', this.props.folder.name);
  }

  componentDidMount(): void {
    this.context.eventBus.on('scrollToImagePropagate', this._scrollToImageIfYours);
  }

  componentWillUnmount(): void {
    this.context.eventBus.removeListener('scrollToImagePropagate', this._scrollToImageIfYours);
  }

  private _scrollToImageIfYours = (_event: ForwardableEvent, ndx: number): void => {
    if (ndx >= this.props.count && ndx < this.props.count + this.props.folder.files.length) {
      this.props.scrollParent(this.grid.getBoundingClientRect().top);
    }
  };

  // Reveal this folder in the Folders sidebar (scroll to it + flash it). Replaces the
  // old "Sync Folder View" context-menu item.
  private _handleSyncFolder = (event: React.MouseEvent): void => {
    event.stopPropagation();
    this.context.eventBus.dispatch(
      new ForwardableEvent('scrollFolderViewToFile'),
      this.props.folder.filename,
    );
  };

  private _handleContextMenu = (event: React.MouseEvent): void => {
    this.context.eventBus.dispatch(
      new ForwardableEvent('folderContextMenu', event.nativeEvent),
      this.props.folder,
      event.nativeEvent,
    );
  };

  // ── Internal drag-and-drop target ───────────────────────────────────
  // Dropping anywhere in a grid targets that grid's folder. Only accept when an
  // in-app drag is in flight (the OS drop carries no usable paths).
  private _handleDragOver = (event: React.DragEvent): void => {
    if (getDragContext()) {
      event.preventDefault(); // allow the drop
      if (!this.state.dragOver) this.setState({ dragOver: true });
    }
  };

  private _handleDragLeave = (): void => {
    if (this.state.dragOver) this.setState({ dragOver: false });
  };

  private _handleDrop = (event: React.DragEvent): void => {
    if (this.state.dragOver) this.setState({ dragOver: false });
    if (!getDragContext()) return;
    event.preventDefault();
    this.context.eventBus.dispatch(
      new ForwardableEvent('dropOnFolder'),
      this.props.folder.filename,
      event.metaKey || event.ctrlKey,
    );
  };

  render(): React.ReactNode {
    this._logger('render');
    const { setCurrentView, folder, width, zoom, gridMode, options } = this.props;
    const { prefs } = this.context;
    const files = folder.files;
    const columnManager = gridModes.value(gridMode).helper(width, {
      padding: options.padding,
      minColumnWidth: zoom(options.columnWidth),
    });
    const count = this.props.count;
    const images = (files as SortInfo[]).map((file, ndx) => {
      const info = file.info as unknown as DBFileInfo;
      const thumbnail = info.thumbnail;
      const id = `thumb-${info.filename}`;
      const pos = columnManager.getPositionForElement(thumbnail.width, thumbnail.height);
      ++g_renderCount;
      return (
        <Thumbnail
          key={id}
          info={info}
          folderKey={folder.filename}
          position={pos}
          showDates={prefs.misc.showDates}
          showDimensions={prefs.misc.showDimensions}
          gridMode={gridMode}
          count={count + ndx}
          zoom={zoom}
          setCurrentView={setCurrentView}
        />
      );
    });
    const style = { height: px(columnManager.height) };
    return (
      <div
        ref={(elem) => { this.grid = elem!; }}
        className={`imagegrid${this.state.dragOver ? ' drag-over' : ''}`}
        onDragOver={this._handleDragOver}
        onDragLeave={this._handleDragLeave}
        onDrop={this._handleDrop}
      >
        <div
          className={`imagegridhead${isVirtualFolderKey(folder.filename) ? ' virtual-folder' : ''}`}
          onContextMenu={this._handleContextMenu}
        >
          <span
            className="sync-folder-btn"
            onClick={this._handleSyncFolder}
            data-tooltip="Reveal in Folders"
          >◀</span>
          {/* Virtual folders have a synthetic vfolder:<id> key, so always show their
              display name rather than the full "path". */}
          {isVirtualFolderKey(folder.filename)
            ? folder.name
            : (prefs.misc.fullPathOnSeparator ? folder.filename : folder.name)}
        </div>
        <div className="grid" style={style}>{images}</div>
      </div>
    );
  }
}

type Props = {
  gotoFolderNdx: number;
  scrollTop: number;
  initialAnchor: ScrollAnchor & { folderName?: string; fileName?: string } | null;
  saveScrollTop: (scrollTop: number, anchor: ScrollAnchor | null) => void;
  root: FolderStateRoot;
  width: number;
  options: Options;
  winState: WinState;
  rotateMode: number;
  setCurrentView: () => void;
  currentImageIndex: number;
};

type State = {
  width: number;
  height: number;
};

export default class ImageGrids extends React.Component<Props, State> {
  static contextType = AppContext;
  declare context: React.ContextType<typeof AppContext>;

  private _logger: ReturnType<typeof debug>;
  private _listenerManager: ListenerManager;
  private _eventBus: ForwardableEventDispatcher;
  private _actionListener!: ActionListener;
  private _imagegrids!: HTMLDivElement;
  private _reactList: VirtualListHandle | null = null;
  private _folders: FolderInfo[] | null = null;
  private _gridMode: GridMode | null = null;
  private _root: FolderStateRoot | null = null;
  private _width: number = 0;
  private _lastZoom: number = 0;
  private _scrollAnchor: ScrollAnchor | null = null;
  private _pendingScrollAnchor: (ScrollAnchor & { folderName?: string; fileName?: string }) | null = null;
  private _programmaticScroll = false;
  private _restoreAnchorTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { width: 0, height: 0 };
    this._logger = debug('ImageGrids');
    this._listenerManager = new ListenerManager();
    this._eventBus = new ForwardableEventDispatcher();
    this._eventBus.debugId = this._logger.getPrefix();
  }

  componentDidMount(): void {
    this._imagegrids.addEventListener('wheel', this._handleWheel as EventListener, { passive: false });
    const on = this._listenerManager.on.bind(this._listenerManager);
    const eventBus = this._eventBus;
    on(eventBus, 'scrollToImage', this._handleScrollToImage);
    on(eventBus, 'toggleSelection', this._handleToggleSelection);

    const actionListener = new ActionListener();
    this._actionListener = actionListener;
    actionListener.on('gotoPrev', this._gotoPrev);
    actionListener.on('gotoNext', this._gotoNext);
    actionListener.on('fastForward', this._gotoNext);
    actionListener.on('fastBackward', this._gotoPrev);
    actionListener.on('selectAll', this._selectAllVisible);
    actionListener.on('clearSelection', this._clearSelection);
    on(eventBus, 'action', this._actionListener.routeAction);

    this.context.eventBus.setForward(this._eventBus);

    this._logger('setScrollStop:', this.props.scrollTop);
    const startingFolderNdx = this.props.gotoFolderNdx;
    if (startingFolderNdx >= 0) {
      this._logger('scrollTo:', startingFolderNdx);
      setRAF(() => {
        this._reactList?.scrollTo(startingFolderNdx);
      }, 2);
    } else {
      const { initialAnchor } = this.props;
      if (initialAnchor && initialAnchor.folderName) {
        this._pendingScrollAnchor = initialAnchor;
        setRAF(() => { this._tryRestoreScrollAnchor(); }, 2);
      } else if (
        initialAnchor &&
        this._folders &&
        initialAnchor.folderIndex >= 0 &&
        initialAnchor.folderIndex < this._folders.length &&
        initialAnchor.fileIndex >= 0 &&
        initialAnchor.fileIndex < this._folders[initialAnchor.folderIndex].folder.files.length
      ) {
        const zoom = this._zoom;
        const options = {
          padding: this.props.options.padding,
          minColumnWidth: zoom(this.props.options.columnWidth),
        };
        const scrollTop = computeThumbScrollTop(
          this._folders, this.props.winState.gridMode,
          this._getWidth(), zoom, options,
          initialAnchor.folderIndex, initialAnchor.fileIndex,
        ) - (initialAnchor.offset || 0);
        this._logger('setScrollTopFromAnchor:', scrollTop, initialAnchor);
        setRAF(() => { this._imagegrids.scrollTop = scrollTop; }, 2);
      } else {
        this._logger('setScrollTop:', this.props.scrollTop);
        const scrollTop = this.props.scrollTop;
        setRAF(() => { this._imagegrids.scrollTop = scrollTop; }, 2);
      }
    }
  }

  componentWillUnmount(): void {
    this._imagegrids.removeEventListener('wheel', this._handleWheel as EventListener);
    this._actionListener.close();
    this.context.eventBus.setForward(null);
    this._listenerManager.removeAll();
    if (this._restoreAnchorTimer !== null) {
      clearTimeout(this._restoreAnchorTimer);
    }
  }

  componentDidUpdate(prevProps: Props): void {
    if (prevProps.winState.sortMode !== this.props.winState.sortMode) {
      // Sort order changed: every grid re-orders, so any scroll position/anchor
      // from the previous sort is meaningless. Jump to the top and forget the
      // old/pending anchors, then cache the top so returning from the Viewer
      // restores the top too (instead of the pre-sort scroll position). The
      // programmatic-scroll flag keeps the resulting scroll event from re-saving.
      this._pendingScrollAnchor = null;
      this._scrollAnchor = null;
      if (this._imagegrids) {
        this._programmaticScroll = true;
        this._imagegrids.scrollTop = 0;
      }
      this.props.saveScrollTop(0, null);
      return;
    }
    const anchor = this._scrollAnchor;
    if (anchor && this._imagegrids && this._folders) {
      this._scrollAnchor = null;
      const newZoom = this._zoom;
      const newOptions = {
        padding: this.props.options.padding,
        minColumnWidth: newZoom(this.props.options.columnWidth),
      };
      const newScrollTop = computeThumbScrollTop(
        this._folders, this.props.winState.gridMode,
        this._getWidth(), newZoom, newOptions,
        anchor.folderIndex, anchor.fileIndex,
      ) - (anchor.offset || 0);
      this._imagegrids.scrollTop = newScrollTop;
      this.props.saveScrollTop(newScrollTop, anchor);
      return;
    }
    if (this._pendingScrollAnchor && prevProps.root !== this.props.root) {
      this._tryRestoreScrollAnchor();
    }
  }

  private _tryRestoreScrollAnchor(): void {
    const anchor = this._pendingScrollAnchor;
    if (!anchor || !this._folders || !this._imagegrids) {
      return;
    }
    let folderIndex = -1;
    let fileIndex = -1;
    for (let fi = 0; fi < this._folders.length; fi++) {
      if (this._folders[fi].folder.filename === anchor.folderName) {
        const files = this._folders[fi].folder.files as SortInfo[];
        for (let ti = 0; ti < files.length; ti++) {
          if (files[ti].info.filename === anchor.fileName) {
            folderIndex = fi;
            fileIndex = ti;
            break;
          }
        }
        if (folderIndex >= 0) break;
      }
    }
    if (folderIndex < 0) return;

    const zoom = this._zoom;
    const options = {
      padding: this.props.options.padding,
      minColumnWidth: zoom(this.props.options.columnWidth),
    };
    const scrollTop = Math.max(0, computeThumbScrollTop(
      this._folders, this.props.winState.gridMode,
      this._getWidth(), zoom, options,
      folderIndex, fileIndex,
    ) - (anchor.offset || 0));
    this._logger('restoreScrollAnchor:', scrollTop, anchor.folderName, anchor.fileName);
    this._programmaticScroll = true;
    this._imagegrids.scrollTop = scrollTop;
  }

  private _gotoNext = (): void => {
    // TODO: Find next on right
  };

  private _gotoPrev = (): void => {
    // TODO: Find next on left
  };

  private _handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const pos = getRotatedXY(e, 'delta', this.props.rotateMode);
    this._imagegrids.scrollTop += pos.y;
  };

  private _handleResize = (contentRect: { client: { width: number; height: number } }): void => {
    if (this.state.width !== contentRect.client.width ||
        this.state.height !== contentRect.client.height) {
      this.setState({
        width: contentRect.client.width,
        height: contentRect.client.height,
      });
    }
  };

  private _zoom: ZoomFn = (v: number): number => this.props.winState.thumbnailZoom * v;

  private _handleScrollToImage = (ndx: number, folderNdx: number): void => {
    this._logger('handleScrollToImage:', ndx, folderNdx);
    this._reactList?.scrollTo(folderNdx);
  };

  // Returns the flat ordered list of all filenames across all folders in this
  // grid, in the same order they're rendered. Used by shift-range selection.
  private _getOrderedEntries(): SelectionEntry[] {
    const result: SelectionEntry[] = [];
    for (const folder of this.props.root.folders) {
      for (const file of folder.files) {
        result.push({ folderKey: folder.filename, filename: file.info.filename });
      }
    }
    return result;
  }

  private _handleToggleSelection = (
    _event: ForwardableEvent,
    folderKey: string,
    filename: string,
    shift: boolean,
  ): void => {
    if (shift) {
      shiftToggleSelection({ folderKey, filename }, this._getOrderedEntries());
    } else {
      toggleSelection(folderKey, filename);
    }
  };

  // Returns entries whose thumbnails currently overlap the viewport.
  private _getVisibleEntries(): SelectionEntry[] {
    const result: SelectionEntry[] = [];
    if (!this._imagegrids) return result;
    const viewportTop = this._imagegrids.scrollTop;
    const viewportBottom = viewportTop + this._imagegrids.clientHeight;
    const gridMode = this.props.winState.gridMode;
    const width = this._getWidth();
    const options: GridOptions = {
      padding: this.props.options.padding,
      minColumnWidth: this._zoom(this.props.options.columnWidth),
    };

    let folderTop = 0;
    for (const folder of this.props.root.folders) {
      const gridHeight = computeFolderHeight(folder, gridMode, width, this._zoom, options);
      const folderBottom = folderTop + g_folderHeaderHeight + gridHeight;

      // Skip folders entirely above or below the viewport
      if (folderBottom < viewportTop || folderTop > viewportBottom) {
        folderTop = folderBottom;
        continue;
      }

      const manager = gridModes.value(gridMode).helper(width, options);
      const files = folder.files;
      for (let ti = 0; ti < files.length; ti++) {
        const info = (files[ti] as SortInfo).info;
        const thumb = info.thumbnail;
        const pos = manager.getPositionForElement(thumb.width, thumb.height);
        const absTop = folderTop + g_folderHeaderHeight + pos.y;
        const absBottom = absTop + pos.height;
        if (absBottom >= viewportTop && absTop <= viewportBottom) {
          result.push({ folderKey: folder.filename, filename: info.filename });
        }
      }

      folderTop = folderBottom;
    }
    return result;
  }

  private _selectAllVisible = (): void => {
    selectEntries(this._getVisibleEntries());
  };

  private _clearSelection = (): void => {
    clearSelection();
  };

  private _scrollToRelativePosition = (pos: number): void => {
    this._logger('scrollToRelativePosition:', pos);
    this._imagegrids.scrollTop = (this._imagegrids.scrollTop + pos) | 0;
  };

  private _addFolders(root: FolderStateRoot): FolderInfo[] {
    let count = 0;
    const gridMode = this.props.winState.gridMode;
    return root.folders.map((folder) => {
      const name = folder.name;
      const files = folder.files;
      const id = `grid-${name}`;
      const startCount = count;
      count += files.length;
      return {
        key: id,
        count: startCount,
        name,
        folder,
        height: computeFolderHeight(folder, gridMode, this._getWidth(), this._zoom, {
          padding: this.props.options.padding,
          minColumnWidth: this._zoom(this.props.options.columnWidth),
        }),
      };
    });
  }

  private _getFoldersFromState(props: Props): void {
    this._folders = this._addFolders(props.root);
    this._rebuildItemHeights();
  }

  private _itemRenderer = (index: number, key: number): React.ReactNode => {
    const info = this._folders![index];
    const width = this._getWidth();
    return (
      <ImageGrid
        key={key}
        count={info.count}
        width={width}
        name={info.name}
        folder={info.folder}
        options={this.props.options}
        gridMode={this.props.winState.gridMode}
        scrollParent={this._scrollToRelativePosition}
        setCurrentView={this.props.setCurrentView}
        currentImageIndex={this.props.currentImageIndex}
        zoom={this._zoom}
        winState={this.props.winState}
      />
    );
  };

  // Heights snapshot for VirtualList. Built fresh whenever the folder list
  // is rebuilt; passed as a stable array reference so VirtualList can
  // memoize its prefix-sum table on identity.
  private _itemHeights: number[] = [];

  private _rebuildItemHeights(): void {
    const folders = this._folders ?? [];
    this._itemHeights = folders.map(f => g_folderHeaderHeight + f.height);
  }

  private _getWidth(): number {
    if (this.props.width > 0) return this.props.width;
    return this._imagegrids ? this._imagegrids.clientWidth : this.state.width;
  }

  private _handleScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    if (this._programmaticScroll) {
      this._programmaticScroll = false;
      return;
    }
    this._pendingScrollAnchor = null;
    const scrollTop = (e.target as HTMLDivElement).scrollTop;
    const options = {
      padding: this.props.options.padding,
      minColumnWidth: this._zoom(this.props.options.columnWidth),
    };
    const anchor = this._folders
      ? findAnchorThumbnail(
          this._folders, this.props.winState.gridMode, this._getWidth(), this._zoom, options, scrollTop,
        )
      : null;
    if (anchor) {
      const anchorAbsoluteY = computeThumbScrollTop(
        this._folders!, this.props.winState.gridMode, this._getWidth(), this._zoom, options,
        anchor.folderIndex, anchor.fileIndex,
      );
      anchor.offset = anchorAbsoluteY - scrollTop;
      const folder = this._folders![anchor.folderIndex];
      anchor.folderName = folder.folder.filename;
      anchor.fileName = (folder.folder.files[anchor.fileIndex] as SortInfo).info.filename;
    }
    this.props.saveScrollTop(scrollTop, anchor);
  };

  render(): React.ReactNode {
    this._logger('imagegrids render count', ++g_imageGridsRenderCount);
    g_renderCount = 0;
    const zoom = this.props.winState.thumbnailZoom;
    const effectiveWidth = this._getWidth();
    if (this.props.winState.gridMode !== this._gridMode ||
        this.props.root !== this._root ||
        effectiveWidth !== this._width ||
        zoom !== this._lastZoom) {
      this._logger('getFoldersFromState-InRender');

      const scrollTop = this._imagegrids ? this._imagegrids.scrollTop : 0;
      if (this._folders && this._imagegrids && scrollTop > 0 && this.props.root === this._root) {
        const oldZoom: ZoomFn = (v) => this._lastZoom * v;
        const oldOptions = {
          padding: this.props.options.padding,
          minColumnWidth: oldZoom(this.props.options.columnWidth),
        };
        this._scrollAnchor = findAnchorThumbnail(
          this._folders, this._gridMode!, this._width, oldZoom, oldOptions, scrollTop,
        );
        if (this._scrollAnchor) {
          const anchorAbsoluteY = computeThumbScrollTop(
            this._folders, this._gridMode!, this._width, oldZoom, oldOptions,
            this._scrollAnchor.folderIndex, this._scrollAnchor.fileIndex,
          );
          this._scrollAnchor.offset = anchorAbsoluteY - scrollTop;
        }
      } else {
        this._scrollAnchor = null;
      }

      this._getFoldersFromState(this.props);
      this._gridMode = this.props.winState.gridMode;
      this._root = this.props.root;
      this._width = effectiveWidth;
      this._lastZoom = zoom;
    }

    const result = (
      <ResizeSensor onResize={this._handleResize}>
        {({ measureRef }) => (
          <VirtualList
            ref={(handle) => {
              this._reactList = handle;
              const el = handle ? handle.domElement : null;
              if (el && el !== this._imagegrids) {
                this._imagegrids = el;
                measureRef(el);
              }
            }}
            className="imagegrids"
            onScroll={this._handleScroll}
            itemHeights={this._itemHeights}
            renderItem={this._itemRenderer}
          />
        )}
      </ResizeSensor>
    );
    this._logger('render count', g_renderCount);
    return result;
  }
}
