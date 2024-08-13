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
import path from 'path';
import {px} from '../../lib/utils';
import {cssArray} from '../../lib/css-utils';
import KeyHelper from '../../lib/key-helper';

const g_backslashRE = /\\/g;
function prepForCSSUrl(url) {
  return url.replace(g_backslashRE, '\\\\');
}

class ColumnManager {
  constructor(totalWidth, options) {
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
  getPositionForElement(thumbnailWidth, thumbnailHeight) {
    const scale =  this.drawWidth / thumbnailWidth;
    const drawHeight = thumbnailHeight * scale;
    const paddedHeight = (this.itemHeight || drawHeight) + this.padding;
    const column = this._getShortestColumn();
    const position = {
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

function computeColumnStyle(props) {
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

function computeGridStyle(displayAspect, props) {
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
    const expand = height / thumbnail.height;
    const thWidth = expand * thumbnail.width;
    bkX      = expand * (-thumbnail.x) - (thWidth - width) / 2;
    bkY      = expand * (-thumbnail.y);
    bkWidth  = expand * thumbnailPageSize;
    bkHeight = expand * thumbnailPageSize;
  } else {
    const expand = width / thumbnail.width;
    const thHeight = expand * thumbnail.height;
    bkX      = expand * -thumbnail.x;
    bkY      = expand * -thumbnail.y - (thHeight - height) / 2;
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

function computeFitStyle(displayAspect, props) {
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
    const shrink = areaWidth / pos.width;
    const thHeight = pos.height * shrink;
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
    const shrink = areaHeight / pos.height;
    const thWidth = pos.width * shrink;
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

const gridModes = new KeyHelper({
  'columns':   {
    icon: 'images/buttons/columns.svg',
    hint: 'columns',
    helper: (width, options) => new ColumnManager(width, options),
    render: renderNoFrame,
    getStyle: computeColumnStyle,
  },
  'grid-fit':  {
    icon: 'images/buttons/grid-fit.svg',
    hint: 'fit',
    helper: (width, options) => new ColumnManager(width, ({itemHeightRatio: 1, ...options})),
    render: renderWithFrame,
    getStyle: (props) => computeFitStyle(1, props),
  },
  'grid-4x3':  {
    icon: 'images/buttons/grid-4-3.svg',
    hint: '4x3',
    helper: (width, options) => new ColumnManager(width, ({itemHeightRatio: 4 / 3, ...options})),
    render: renderNoFrame,
    getStyle: (props) => computeGridStyle(4 / 3, props),
  },
  'grid-3x4':  {
    icon: 'images/buttons/grid-3-4.svg',
    hint: '3x4',
    helper: (width, options) => new ColumnManager(width, ({itemHeightRatio: 3 / 4, ...options})),
    render: renderNoFrame,
    getStyle: (props) => computeGridStyle(3 / 4, props),
  },
  'grid-16x9': {
    icon: 'images/buttons/grid-16-9.svg',
    hint: '16x9',
    helper: (width, options) => new ColumnManager(width, ({itemHeightRatio: 16 / 9, ...options})),
    render: renderNoFrame,
    getStyle: (props) => computeGridStyle(16 / 9, props),
  },
  'grid-9x16': {
    icon: 'images/buttons/grid-9-16.svg',
    hint: '9x16',
    helper: (width, options) => new ColumnManager(width, ({itemHeightRatio: 9 / 16, ...options})),
    render: renderNoFrame,
    getStyle: (props) => computeGridStyle(9 / 16, props),
  },
  'grid-1x1':  {
    icon: 'images/buttons/grid-1-1.svg',
    hint: '1x1',
    helper: (width, options) => new ColumnManager(width, ({itemHeightRatio: 1, ...options})),
    render: renderNoFrame,
    getStyle: (props) => computeGridStyle(1, props),
  },
});

const s_slashRE = /[\\/]/g;

function renderName(props, info) {
  const name = path.basename(info.filename);
  const date = props.showDates ? `${(new Date(info.mtime))}:` : '';
  const dims = (props.showDimensions && info.width) ? `:${info.width}x${info.height}` : '';
  return `${date}${name}${dims}`;
}

function renderNoFrame(props, onClick, onContextMenu) {
  const info = props.info;
  const style = gridModes.value(props.gridMode).getStyle(props);
  const baseType = `mime-${info.type.split('/')[0]}`;
  const mimeType = `mime-${info.type.replace(s_slashRE, '-')}`;
  const className = cssArray('thumbnail', baseType, mimeType);
  return (
    <div onClick={onClick} onContextMenu={onContextMenu} className={className} style={style}>
      <div className="thumbinfo">
        <div className="name">{renderName(props, info)}</div>
      </div>
    </div>
  );
}
function renderWithFrame(props, onClick, onContextMenu) {
  const info = props.info;
  const pos = props.position;
  const style = gridModes.value(props.gridMode).getStyle(props);
  const baseType = `mime-${info.type.split('/')[0]}`;
  const mimeType = `mime-${info.type.replace(s_slashRE, '-')}`;
  const className = cssArray('thumbnail', baseType, mimeType);
  const frameStyle = {
    left: px(pos.x),
    top: px(pos.y),
    width: px(pos.width),
    height: px(pos.width),
  };
  return (
    <div>
      <div className="thumbnail-frame" style={frameStyle}></div>
      <div onClick={onClick} onContextMenu={onContextMenu} className={className} style={style}>
        <div className="thumbinfo">
          <div className="name">{renderName(props, info)}</div>
        </div>
      </div>
    </div>
  );
}

export default gridModes;
