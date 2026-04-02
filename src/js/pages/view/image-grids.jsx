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

import React from 'react';
import VirtualList from '../../lib/ui/virtual-list';
import ResizeSensor from '../../lib/ui/resize-sensor';
import {action} from 'mobx';
import {observer} from 'mobx-react';
import bind from '../../lib/bind';
import {getRotatedXY} from '../../lib/rotatehelper';  // eslint-disable-line
import ListenerManager from '../../lib/listener-manager';
import debug from '../../lib/debug';
import ForwardableEvent from '../../lib/forwardable-event';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher';
import Thumbnail from './thumbnail';
import ActionListener from '../../lib/action-listener';
import {px} from '../../lib/utils';
import gridModes from './grid-modes';
import {setRAF} from '../../lib/wait';

let g_imageGridsRenderCount = 0;
let g_renderCount = 0;
const g_folderHeaderHeight = 30;

// Should pass this down to imagegrid
function computeFolderHeight(folder, gridMode, width, zoom, options) {
  if (!folder.files || folder.files.length === 0) {
    return 0;
  }
  const manager = gridModes.value(gridMode).helper(width, options);
  folder.files.forEach((file) => {
    const info = file.info;
    const thumbnail = info.thumbnail;
    /* const pos = */ manager.getPositionForElement(thumbnail.width, thumbnail.height);
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
export function findAnchorThumbnail(folders, gridMode, width, zoomFn, options, scrollTop) {
  let folderTop = 0;
  for (let fi = 0; fi < folders.length; fi++) {
    const folder = folders[fi].folder;
    const files = folder.files;
    const gridHeight = computeFolderHeight(folder, gridMode, width, zoomFn, options);
    const folderBottom = folderTop + g_folderHeaderHeight + gridHeight;

    if (folderBottom > scrollTop) {
      // scrollTop falls within this folder's area
      const relScrollTop = scrollTop - folderTop - g_folderHeaderHeight;
      // if relScrollTop <= 0, the viewport is on the header; thumbnails at y=0 will match
      const manager = gridModes.value(gridMode).helper(width, options);
      let bestTi = -1;
      let bestY = Infinity;
      // Allow 1px tolerance: browsers round fractional scrollTop values, which
      // can shift a thumbnail's top edge just above the viewport. Without
      // tolerance this causes the anchor to advance by one thumbnail per zoom
      // step, drifting the view across many folders over a series of steps.
      const snapTolerance = 1;
      for (let ti = 0; ti < (files ? files.length : 0); ti++) {
        const thumbnail = files[ti].info.thumbnail;
        const pos = manager.getPositionForElement(thumbnail.width, thumbnail.height);
        if (pos.y >= relScrollTop - snapTolerance && pos.y < bestY) {
          bestY = pos.y;
          bestTi = ti;
        }
      }
      if (bestTi >= 0) {
        return {folderIndex: fi, fileIndex: bestTi};
      }
    }

    folderTop = folderBottom;
  }
  return null;
}

// Given a folder+file anchor, computes the absolute scrollTop such that the
// anchor thumbnail's top edge is at the top of the viewport.
//
// `folders` must be an array of {folder} objects (same shape as this._folders).
export function computeThumbScrollTop(folders, gridMode, width, zoomFn, options, folderIndex, fileIndex) {
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
    const thumbnail = files[ti].info.thumbnail;
    const pos = manager.getPositionForElement(thumbnail.width, thumbnail.height);
    if (ti === fileIndex) {
      top += pos.y;
    }
  }
  return top;
}

class ImageGrid extends React.Component {
  constructor(props) {
    super(props);
    bind(
      this,
      '_scrollToImageIfYours',
      '_handleContextMenu',
    );
    this._logger = debug('ImageGrid', this.props.folder.name);
  }
  componentDidMount() {
    this.props.eventBus.on('scrollToImagePropagate', this._scrollToImageIfYours);
  }
  componentWillUnmount() {
    this.props.eventBus.removeListener('scrollToImagePropagate', this._scrollToImageIfYours);
  }
  _scrollToImageIfYours(ndx) {
    if (ndx >= this.props.count && ndx < this.props.count + this.props.folder.files.length) {
      this.props.scrollParent(this.grid.getBoundingClientRect().top);
    }
  }
  _handleContextMenu(event) {
    this.props.eventBus.dispatch(new ForwardableEvent('folderContextMenu', event), this.props.folder, event);
  }
  render() {
    this._logger('render');
    const {
      setCurrentView,
      currentImageIndex,
      eventBus,
      folder,
      width,
      zoom,
      gridMode,
      options,
      prefs,
    } = this.props;
    let grid = '';
    const files = folder.files;
    const columnManager = gridModes.value(gridMode).helper(width, {
      padding: options.padding,
      minColumnWidth: zoom(options.columnWidth),
    }); // TODO: pass in
    const count = this.props.count;
    const images = files.map((file, ndx) => {
      const info = file.info;
      const thumbnail = info.thumbnail;
      const id = `thumb-${info.filename}`;
      const pos = columnManager.getPositionForElement(thumbnail.width, thumbnail.height);
      ++g_renderCount;
      return (
        <Thumbnail
          key={id}
          info={info}
          position={pos}
          showDates={prefs.misc.showDates}
          showDimensions={prefs.misc.showDimensions}
          gridMode={gridMode}
          options={options}
          eventBus={eventBus}
          count={count + ndx}
          currentImage={currentImageIndex === count + ndx}
          zoom={zoom}
          setCurrentView={setCurrentView}
        />
      );
    });
    const style = {
      height: px(columnManager.height),
    };
    grid = (
      <div className="grid" style={style}>{images}</div>
    );
    return (
      <div ref={(elem) => { this.grid = elem; }} className="imagegrid">
        <div className="imagegridhead" onContextMenu={this._handleContextMenu}>
          {prefs.misc.fullPathOnSeparator ? folder.filename : folder.name}
        </div>
        {grid}
      </div>
    );
  }
}

@observer
export default class ImageGrids extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      width: 0,
      height: 0,
    };
    bind(
      this,
      '_handleScrollToImage',
      '_handleResize',
      '_scrollToRelativePosition',
      '_handleSetCollection',
      '_handleScroll',
      '_itemRenderer',
      '_itemSizeGetter',
      '_handleWheel',
      '_zoom',
      '_gotoNext',
      '_gotoPrev',
      '_tryRestoreScrollAnchor',
    );
    this._logger = debug('ImageGrids');
    this._listenerManager = new ListenerManager();
    this._eventBus = new ForwardableEventDispatcher();
    this._eventBus.debugId = this._logger.getPrefix();
  }
  componentDidMount() {
    this._imagegrids.addEventListener('wheel', this._handleWheel, {passive: false});
    const on = this._listenerManager.on.bind(this._listenerManager);
    const eventBus = this._eventBus;
    on(eventBus, 'setCollection', this._handleSetCollection);
    // TODO: this should happen at app level and then forward to correct event bus
    on(eventBus, 'scrollToImage', this._handleScrollToImage);

    const actionListener = new ActionListener();
    this._actionListener = actionListener;

    actionListener.on('gotoPrev', this._gotoPrev);
    actionListener.on('gotoNext', this._gotoNext);
    actionListener.on('fastForward', this._gotoNext);
    actionListener.on('fastBackward', this._gotoPrev);

    on(eventBus, 'action', this._actionListener.routeAction);

    this.props.eventBus.setForward(this._eventBus);

    this._logger('setScrollStop:', this.props.scrollTop);
    const startingFolderNdx = this.props.gotoFolderNdx;
    if (startingFolderNdx >= 0) {
      this._logger('scrollTo:', startingFolderNdx);
      setRAF(() => {
        this._reactList.scrollTo(startingFolderNdx);
      }, 2);
    } else {
      const {initialAnchor} = this.props;
      if (initialAnchor && initialAnchor.folderName) {
        // Filename-based anchor: deferred restore since files may not be loaded yet
        this._pendingScrollAnchor = initialAnchor;
        setRAF(() => {
          this._tryRestoreScrollAnchor();
        }, 2);
      } else if (initialAnchor && this._folders) {
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
        setRAF(() => {
          this._imagegrids.scrollTop = scrollTop;
        }, 2);
      } else {
        this._logger('setScrollTop:', this.props.scrollTop);
        const scrollTop = this.props.scrollTop;
        setRAF(() => {
          this._imagegrids.scrollTop = scrollTop;
        }, 2);
      }
    }
  }
  componentWillUnmount() {
    this._imagegrids.removeEventListener('wheel', this._handleWheel, {passive: false});
    this._actionListener.close();
    this.props.eventBus.setForward(null);
    this._listenerManager.removeAll();
    clearTimeout(this._restoreAnchorTimer);
  }
  componentDidUpdate(prevProps) {
    const anchor = this._scrollAnchor;
    if (anchor && this._imagegrids && this._folders) {
      this._scrollAnchor = null;
      const newZoom = this._zoom;
      const newOptions = {
        padding: this.props.options.padding,
        minColumnWidth: newZoom(this.props.options.columnWidth),
      };
      const newScrollTop = computeThumbScrollTop(
        this._folders,
        this.props.winState.gridMode,
        this._getWidth(),
        newZoom,
        newOptions,
        anchor.folderIndex,
        anchor.fileIndex,
      ) - (anchor.offset || 0);
      this._imagegrids.scrollTop = newScrollTop;
      this.props.saveScrollTop(newScrollTop, anchor);
      return;
    }
    if (this._pendingScrollAnchor && prevProps.root !== this.props.root) {
      this._tryRestoreScrollAnchor();
    }
  }
  _tryRestoreScrollAnchor() {
    const anchor = this._pendingScrollAnchor;
    if (!anchor || !this._folders || !this._imagegrids) {
      return;
    }
    let folderIndex = -1;
    let fileIndex = -1;
    for (let fi = 0; fi < this._folders.length; fi++) {
      if (this._folders[fi].folder.filename === anchor.folderName) {
        const files = this._folders[fi].folder.files;
        for (let ti = 0; ti < files.length; ti++) {
          if (files[ti].info.filename === anchor.fileName) {
            folderIndex = fi;
            fileIndex = ti;
            break;
          }
        }
        if (folderIndex >= 0) {
          break;
        }
      }
    }
    if (folderIndex < 0) {
      return;
    }
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
  @action _handleSetCollection(event) {
    this.props.imagegridState.currentCollection = event.collection;
  }
  _gotoNext() {
    // TODO: Find next on right
  }
  _gotoPrev() {
    // TODO: Find next on left
  }
  _handleWheel(e) {
    e.preventDefault();
    const pos = getRotatedXY(e, 'delta', this.props.rotateMode);
    this._imagegrids.scrollTop += pos.y;
  }
  _handleResize(contentRect) {
    if (this.state.width !== contentRect.client.width ||
        this.state.height !== contentRect.client.height) {
      this.setState({
        width: contentRect.client.width,
        height: contentRect.client.height,
      });
    }
  }
  _zoom(v) {
    return this.props.winState.thumbnailZoom * v;
  }
  _handleScrollToImage(ndx, folderNdx) {
    this._logger('handleScrollToImage:', ndx, folderNdx);
    this._reactList.scrollTo(folderNdx);
  }
  _scrollToRelativePosition(pos) {
    this._logger('scrollToRelativePosition:', pos);
    this._imagegrids.scrollTop = this._imagegrids.scrollTop + pos | 0;
  }
  _addFolders(root, dirName, inCount) {
    // this._logger('addFolders:', dirName);
    let count = inCount;
    const gridMode = this.props.winState.gridMode;
    return root.folders.map((folder) => {
      const name = folder.name;
      const files = folder.files;
      const id = `grid-${dirName}-${name}`;
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
  _getFoldersFromState(props) {
    this._folders = this._addFolders(props.root, '', 0);
    // this._logger('num folders:', this._folders.length, '\n', this._folders);
  }
  _itemRenderer(index, key) {
    const info = this._folders[index];
    const width = this._getWidth();
    return (
      <ImageGrid
        key={key}
        count={info.count}
        width={width}
        name={info.name}
        folder={info.folder}
        eventBus={this.props.eventBus}
        options={this.props.options}
        prefs={this.props.prefs}
        gridMode={this.props.winState.gridMode}
        scrollParent={this._scrollToRelativePosition}
        setCurrentView={this.props.setCurrentView}
        currentImageIndex={this.props.currentImageIndex}
        zoom={this._zoom}
        winState={this.props.winState}
      />
    );
  }
  _getNumItems() {
    return this._folders ? this._folders.length : 0;
  }
  _itemSizeGetter(index) {
    const info = this._folders[index];
    this._logger('height index:', index, 'height:', info.height);
    return g_folderHeaderHeight + info.height;
  }
  _getWidth() {
    // props.width comes from ViewSplit's Yoga layout and reflects the new
    // container width in the same render cycle. this._imagegrids.clientWidth
    // is stale during render (DOM not yet committed), so prefer props.width.
    if (this.props.width > 0) return this.props.width;
    return (this._imagegrids) ? this._imagegrids.clientWidth : this.state.width;
  }
  _handleScroll(e) {
    if (this._programmaticScroll) {
      this._programmaticScroll = false;
      return;
    }
    this._pendingScrollAnchor = null;
    const scrollTop = e.target.scrollTop;
    const anchor = this._folders
      ? findAnchorThumbnail(
          this._folders, this.props.winState.gridMode, this._getWidth(), this._zoom,
          {padding: this.props.options.padding, minColumnWidth: this._zoom(this.props.options.columnWidth)},
          scrollTop,
        )
      : null;
    if (anchor) {
      const anchorAbsoluteY = computeThumbScrollTop(
        this._folders, this.props.winState.gridMode, this._getWidth(), this._zoom,
        {padding: this.props.options.padding, minColumnWidth: this._zoom(this.props.options.columnWidth)},
        anchor.folderIndex, anchor.fileIndex,
      );
      anchor.offset = anchorAbsoluteY - scrollTop;
      const folder = this._folders[anchor.folderIndex];
      anchor.folderName = folder.folder.filename;
      anchor.fileName = folder.folder.files[anchor.fileIndex].info.filename;
    }
    this.props.saveScrollTop(scrollTop, anchor);
  }
  render() {
    this._logger('imagegrids render count', ++g_imageGridsRenderCount);
    g_renderCount = 0;
    // Is this a hack or is it ok?
    const zoom = this.props.winState.thumbnailZoom;
    // Use the width passed from ViewSplit when available — it reflects the new
    // container size in the same render cycle, before ResizeObserver fires.
    const effectiveWidth = this._getWidth();
    if (this.props.winState.gridMode !== this._gridMode ||
        this.props.root !== this._root ||
        effectiveWidth !== this._width ||
        zoom !== this._lastZoom) {
      this._logger('getFoldersFromState-InRender');

      // Capture scroll anchor before recomputing layout. This must happen here
      // (not in getSnapshotBeforeUpdate) because MobX mutates observables
      // in-place, so prevProps.winState === this.props.winState by the time
      // getSnapshotBeforeUpdate fires and change detection would always be false.
      // At this point this._folders, this._gridMode, this._width, and
      // this._lastZoom still reflect the previous layout.
      const scrollTop = this._imagegrids ? this._imagegrids.scrollTop : 0;
      if (this._folders && this._imagegrids && scrollTop > 0 &&
          this.props.root === this._root) {
        const oldZoom = (v) => this._lastZoom * v;
        const oldOptions = {
          padding: this.props.options.padding,
          minColumnWidth: oldZoom(this.props.options.columnWidth),
        };
        this._scrollAnchor = findAnchorThumbnail(
          this._folders,
          this._gridMode,
          this._width,
          oldZoom,
          oldOptions,
          scrollTop,
        );
        if (this._scrollAnchor) {
          const anchorAbsoluteY = computeThumbScrollTop(
            this._folders, this._gridMode, this._width, oldZoom, oldOptions,
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
            length={this._getNumItems()}
            itemHeight={this._itemSizeGetter}
            renderItem={this._itemRenderer}
          />
        )}
      </ResizeSensor>
    );
    this._logger('render count', g_renderCount);
    return result;
  }
}
