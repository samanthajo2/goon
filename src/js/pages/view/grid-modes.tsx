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
import path from 'node:path';
import {px} from '../../lib/utils';
import {cssArray} from '../../lib/css-utils';
import KeyHelper from '../../lib/key-helper';
import { Rect } from '../../lib/rect';
import { DBFileInfo } from './folder-db';
import {trashingFiles, subscribeTrashingFiles} from './trashing-state';

// Small self-contained component that subscribes to trashing state changes.
// Keeping this separate avoids making every Thumbnail an MobX observer.
class TrashingOverlay extends React.Component<{filename: string}> {
  _unsubscribe?: () => void;
  componentDidMount() {
    this._unsubscribe = subscribeTrashingFiles(() => this.forceUpdate());
  }
  componentWillUnmount() {
    this._unsubscribe?.();
  }
  render() {
    return trashingFiles.has(this.props.filename) ? <div className="trashing-overlay" /> : null;
  }
}

const g_backslashRE = /\\/g;
function prepForCSSUrl(url: string) {
  return url.replace(g_backslashRE, '\\\\');
}

type ColumnManagerOptions = {
  minColumnWidth: number;
  padding: number;
  itemHeightRatio?: number;
};

type Column = {
  ndx: number,
  bottom: number,
};

class ColumnManager {
  columns: Column[];
  height: number;
  padding: number;
  columnWidth: number;
  columnOffset: number;
  drawWidth: number;
  itemHeight: number = 0;

  constructor(totalWidth: number, options: ColumnManagerOptions) {
    this.columns = [];
    this.height = 0;
    this.padding = options.padding;
    const numColumns = (totalWidth / options.minColumnWidth | 0) || 1;
    this.columnWidth = totalWidth / numColumns | 0;
    this.columnOffset = this.padding / 2;
    this.drawWidth = this.columnWidth - this.padding;
    if (options.itemHeightRatio) {
      this.itemHeight = this.columnWidth / options.itemHeightRatio;
    }
    for (let ii = 0; ii < numColumns; ++ii) {
      this.columns.push({
        ndx: ii,
        bottom: 0,
      });
    }
  }
  _getShortestColumn() {
    let shortest = this.columns[0];
    this.columns.forEach((column) => {
      if (column.bottom < shortest.bottom) {
        shortest = column;
      }
    });
    return shortest;
  }
  getPositionForElement(thumbnailWidth: number, thumbnailHeight: number) {
    const scale =  this.drawWidth / thumbnailWidth;
    const drawHeight = thumbnailHeight * scale;
    const paddedHeight = (this.itemHeight || drawHeight) + this.padding;
    const column = this._getShortestColumn();
    const position: Rect = {
      x: this.columnWidth * column.ndx + this.columnOffset,
      y: column.bottom,
      width: this.drawWidth,
      height: drawHeight,
    };
    column.bottom += paddedHeight;
    this.height = Math.max(column.bottom - this.padding, this.height);
    return position;
  }
}

function computeColumnStyle(props: ThumbnailProps) {
  const info = props.info;
  const pos = props.position;
  const thumbnail = info.thumbnail;
  const thumbnailPageSize = info.bad ? 150 : thumbnail.pageSize;
  const width = pos.width;
  const scale = width / thumbnail.width;

  return {
    left: px(pos.x),
    top: px(pos.y),
    width: px(pos.width),
    height: px(pos.height),
    backgroundImage: `url(${prepForCSSUrl(thumbnail.url)})`,
    backgroundPositionX: px(-thumbnail.x * scale),
    backgroundPositionY: px(-thumbnail.y * scale),
    backgroundSize: `${px(thumbnailPageSize * scale)} ${px(thumbnailPageSize * scale)}`,
  };
}

function computeGridStyle(displayAspect: number, props: ThumbnailProps) {
  const info = props.info;
  const pos = props.position;
  const thumbnail = info.thumbnail;
  const zoom = props.zoom;
  const thumbnailPageSize = info.bad ? 150 : thumbnail.pageSize;

  const imageAspect = thumbnail.width / thumbnail.height;
  const width  = pos.width;
  const height = width / displayAspect;

  let bkX;
  let bkY;
  let bkWidth;
  let bkHeight;

  if (imageAspect > displayAspect) {
    const expand = height / zoom(thumbnail.height);
    bkX      = expand * (-thumbnail.x - (thumbnail.width - width / zoom(expand)) / 2);
    bkY      = expand * (-thumbnail.y);
    bkWidth  = expand * thumbnailPageSize;
    bkHeight = expand * thumbnailPageSize;
  } else {
    const expand = width / zoom(thumbnail.width);
    bkX      = expand * -thumbnail.x;
    bkY      = expand * (-thumbnail.y - (thumbnail.height - height / zoom(expand)) / 2);
    bkWidth  = expand * thumbnailPageSize;
    bkHeight = expand * thumbnailPageSize;
  }

  return {
    left: px(pos.x),
    top: px(pos.y),
    width: px(width),
    height: px(height),
    backgroundImage: `url(${prepForCSSUrl(thumbnail.url)})`,
    backgroundPositionX: px(zoom(bkX)),
    backgroundPositionY: px(zoom(bkY)),
    backgroundSize: `${px(zoom(bkWidth))} ${px(zoom(bkHeight))}`,
  };
}

function format1(v: number) {
  const s = v.toFixed(1);
  if (s.endsWith('.0')) {
    return s.slice(0, -2);
  }
  return s;
}

function shortDuration(duration?: number) {
  if (!duration) {
    return '▶';
  }
  const hours = duration / 60 / 60;
  if (hours >= 1 ) {
    return `▶${format1(hours)}h`;
  }
  const minutes = Math.floor(duration / 60);
  if (minutes >= 1) {
    return `▶${format1(minutes)}m`;
  }
  return `▶${Math.round(duration)}s`;
}

export type GridMode = keyof typeof gridModeDefs;

type ThumbnailProps = {
  position: Rect;
  zoom: (v: number) => number;
  showDates: boolean;
  showDimensions: boolean;
  gridMode: GridMode;
  info: DBFileInfo;
};

function computeFitStyle(displayAspect: number, props: ThumbnailProps) {
  const info = props.info;
  const pos = props.position;
  const thumbnail = info.thumbnail;
  const zoom = props.zoom;
  const thumbnailPageSize = info.bad ? 150 : thumbnail.pageSize;

  const imageAspect = thumbnail.width / thumbnail.height;
  const areaWidth  = pos.width;
  const areaHeight = areaWidth / displayAspect;

  let bkX;
  let bkY;
  let bkWidth;
  let bkHeight;
  let x;
  let y;
  let width;
  let height;

  if (imageAspect > displayAspect) {
    // it's wider than the area
    //const shrink = areaWidth / pos.width;
    const shrink = areaWidth / zoom(thumbnail.width);
    const thHeight = areaWidth / imageAspect;
    x        = pos.x;
    y        = pos.y + (areaHeight - thHeight) / 2;
    width    = areaWidth;
    height   = thHeight;
    bkX      = shrink * (-thumbnail.x);
    bkY      = shrink * (-thumbnail.y);
    bkWidth  = shrink * thumbnailPageSize;
    bkHeight = shrink * thumbnailPageSize;
  } else {
    // it's taller than the area
    const shrink = areaHeight / zoom(thumbnail.height);
    const thWidth = areaHeight * imageAspect;
    x        = pos.x + (areaWidth - thWidth) / 2;
    y        = pos.y;
    width    = thWidth;
    height   = areaHeight;
    bkX      = -thumbnail.x * shrink;
    bkY      = -thumbnail.y * shrink;
    bkWidth  = thumbnailPageSize * shrink;
    bkHeight = thumbnailPageSize * shrink;
  }

  return {
    left: px(x),
    top: px(y),
    width: px(width),
    height: px(height),
    backgroundImage: `url(${prepForCSSUrl(thumbnail.url)})`,
    backgroundPositionX: px(zoom(bkX)),
    backgroundPositionY: px(zoom(bkY)),
    backgroundSize: `${px(zoom(bkWidth))} ${px(zoom(bkHeight))}`,
  };
}

const gridModeDefs = {
  'columns':   {
    icon: 'images/buttons/columns.svg',
    hint: 'columns',
    helper: (width: number, options: ColumnManagerOptions) => new ColumnManager(width, options),
    render: renderNoFrame,
    getStyle: computeColumnStyle,
  },
  'grid-fit':  {
    icon: 'images/buttons/grid-fit.svg',
    hint: 'fit',
    helper: (width: number, options: ColumnManagerOptions) => new ColumnManager(width, ({itemHeightRatio: 1, ...options})),
    render: renderWithFrame,
    getStyle: (props: ThumbnailProps) => computeFitStyle(1, props),
  },
  'grid-4x3':  {
    icon: 'images/buttons/grid-4-3.svg',
    hint: '4x3',
    helper: (width: number, options: ColumnManagerOptions) => new ColumnManager(width, ({itemHeightRatio: 4 / 3, ...options})),
    render: renderNoFrame,
    getStyle: (props: ThumbnailProps) => computeGridStyle(4 / 3, props),
  },
  'grid-3x4':  {
    icon: 'images/buttons/grid-3-4.svg',
    hint: '3x4',
    helper: (width: number, options: ColumnManagerOptions) => new ColumnManager(width, ({itemHeightRatio: 3 / 4, ...options})),
    render: renderNoFrame,
    getStyle: (props: ThumbnailProps) => computeGridStyle(3 / 4, props),
  },
  'grid-16x9': {
    icon: 'images/buttons/grid-16-9.svg',
    hint: '16x9',
    helper: (width: number, options: ColumnManagerOptions) => new ColumnManager(width, ({itemHeightRatio: 16 / 9, ...options})),
    render: renderNoFrame,
    getStyle: (props: ThumbnailProps) => computeGridStyle(16 / 9, props),
  },
  'grid-9x16': {
    icon: 'images/buttons/grid-9-16.svg',
    hint: '9x16',
    helper: (width: number, options: ColumnManagerOptions) => new ColumnManager(width, ({itemHeightRatio: 9 / 16, ...options})),
    render: renderNoFrame,
    getStyle: (props: ThumbnailProps) => computeGridStyle(9 / 16, props),
  },
  'grid-1x1':  {
    icon: 'images/buttons/grid-1-1.svg',
    hint: '1x1',
    helper: (width: number, options: ColumnManagerOptions) => new ColumnManager(width, ({itemHeightRatio: 1, ...options})),
    render: renderNoFrame,
    getStyle: (props: ThumbnailProps) => computeGridStyle(1, props),
  },
} as const;

export type GridModes = keyof typeof gridModeDefs;
const gridModes = new KeyHelper(gridModeDefs);

const s_slashRE = /[\\/]/g;

function renderName(props: ThumbnailProps, info: DBFileInfo) {
  const name = path.basename(info.filename);
  const date = props.showDates ? `${(new Date(info.mtime))}:` : '';
  const dims = (props.showDimensions && info.width) ? `:${info.width}x${info.height}` : '';
  return `${date}${name}${dims}`;
}

function renderNoFrame(props: ThumbnailProps, onClick: () => void, onContextMenu: () => void, onDragStart: () => void) {
  const info = props.info;
  const style = gridModes.value(props.gridMode).getStyle(props);
  const baseType = `mime-${info.type.split('/')[0]}`;
  const mimeType = `mime-${info.type.replace(s_slashRE, '-')}`;
  const className = cssArray('thumbnail', baseType, mimeType);
  const duration = shortDuration(info.duration);
  return (
    <div draggable="true" data-duration={duration} onClick={onClick} onDragStart={onDragStart} onContextMenu={onContextMenu} className={className.toString()} style={style}>
      <div className="thumbinfo">
        <div className="name">{renderName(props, info)}</div>
      </div>
      <TrashingOverlay filename={info.filename} />
    </div>
  );
}
function renderWithFrame(props: ThumbnailProps, onClick: () => void, onContextMenu: () => void, onDragStart: () => void) {
  const info = props.info;
  const pos = props.position;
  const style = gridModes.value(props.gridMode).getStyle(props);
  const baseType = `mime-${info.type.split('/')[0]}`;
  const mimeType = `mime-${info.type.replace(s_slashRE, '-')}`;
  const className = cssArray('thumbnail', baseType, mimeType);
  const duration = shortDuration(info.duration);
  const frameStyle = {
    left: px(pos.x),
    top: px(pos.y),
    width: px(pos.width),
    height: px(pos.width),
  };
  return (
    <div>
      <div className="thumbnail-frame" style={frameStyle}></div>
      <div draggable="true" data-duration={duration} onClick={onClick} onContextMenu={onContextMenu} onDragStart={onDragStart} className={className.toString()} style={style}>
        <div className="thumbinfo">
          <div className="name">{renderName(props, info)}</div>
        </div>
        <TrashingOverlay filename={info.filename} />
      </div>
    </div>
  );
}

export default gridModes;
