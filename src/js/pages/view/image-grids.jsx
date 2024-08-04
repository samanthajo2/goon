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
import ReactList from 'react-list';
import Measure from 'react-measure';
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
  const manager = gridModes.value(gridMode).helper(width, options);
  folder.files.forEach((file) => {
    const info = file.info;
    const thumbnail = info.thumbnail;
    /* const pos = */ manager.getPositionForElement(thumbnail.width, thumbnail.height);
  });
  return manager.height;
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
    on(eventBus, 'setcollection', this._handleSetCollection);
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
      this._logger('setScrollTop:', this.props.scrollTop);
      const scrollTop = this.props.scrollTop;
      setRAF(() => {
        this._imagegrids.scrollTop = scrollTop;
      }, 2);
    }
  }
  componentWillUnmount() {
    this._imagegrids.removeEventListener('wheel', this._handleWheel, {passive: false});
    this._actionListener.close();
    this.props.eventBus.setForward(null);
    this._listenerManager.removeAll();
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
    return (this._imagegrids) ? this._imagegrids.clientWidth : this.state.width;
  }
  _handleScroll(e) {
    this.props.saveScrollTop(e.target.scrollTop);
  }
  render() {
    this._logger('imagegrids render count', ++g_imageGridsRenderCount);
    g_renderCount = 0;
    // Is this a hack or is it ok?
    if (this.props.winState.gridMode !== this._gridMode ||
        this.props.root !== this._root ||
        this.state.width !== this._width) {
      this._logger('getFoldersFromState-InRender');

      this._getFoldersFromState(this.props);
      this._gridMode = this.props.winState.gridMode;
      this._root = this.props.root;
      this._width = this.state.width;
    }
    const result = (
      <Measure client onResize={this._handleResize}>
        {({ measureRef }) => (
          <div
            className="imagegrids"
            onScroll={this._handleScroll}
            ref={(imagegrids) => {
              if (imagegrids && imagegrids !== this._imagegrids) {
                this._imagegrids = imagegrids;
                measureRef(imagegrids);
              }
            }}
          >
            <ReactList
              ref={(reactList) => { this._reactList = reactList; }}
              itemRenderer={this._itemRenderer}
              itemSizeGetter={this._itemSizeGetter}
              length={this._getNumItems()}
              type="variable"
              zoom={this.props.winState.thumbnailZoom}
            />
          </div>
        )}
      </Measure>
    );
    this._logger('render count', g_renderCount);
    return result;
  }
}
