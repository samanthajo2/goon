/*
Copyright 2026 SamanthaJo

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

import React, { use } from 'react';
import * as path from '../../lib/path-helpers.js';
import Modal from '../../lib/ui/modal.js';
import { px } from '../../lib/utils.js';
import type { FileInfo } from '../../lib/fileinfo.js';
import { AppContext } from './contexts.js';

const THUMB_SIZE = 64;

const g_backslashRE = /\\/g;
function prepForCSSUrl(url: string): string {
  return url.replace(g_backslashRE, '\\\\');
}

export type DeleteItem = {
  filename: string;
  info: FileInfo;
};

type Props = {
  items: DeleteItem[];
  okay?: string;
  cancel?: string;
  headline?: string;  // override the default headline
  onOkay: () => void;
  onCancel: () => void;
  parent?: HTMLElement;
};

function archiveTag(info: FileInfo): string | null {
  if (!info.archiveName) return null;
  const ext = path.extname(info.archiveName).toLowerCase().replace(/^\./, '');
  return ext || 'archive';
}

function thumbStyle(info: FileInfo, fileToUrl: (p: string) => string): React.CSSProperties {
  const thumb = info.thumbnail;
  if (!thumb || !thumb.url) {
    return { width: px(THUMB_SIZE), height: px(THUMB_SIZE), background: '#444' };
  }
  // Standard CSS sprite: size the box to the tile's drawn dimensions so the
  // background slice fits exactly — no adjacent tiles can show.
  const scale = THUMB_SIZE / Math.max(thumb.width, thumb.height);
  const pageSize = (info.bad ? 150 : thumb.pageSize) * scale;
  return {
    width: px(thumb.width * scale),
    height: px(thumb.height * scale),
    backgroundImage: `url(${prepForCSSUrl(fileToUrl(thumb.url))})`,
    backgroundPositionX: px(-thumb.x * scale),
    backgroundPositionY: px(-thumb.y * scale),
    backgroundSize: `${px(pageSize)} ${px(pageSize)}`,
    backgroundRepeat: 'no-repeat',
  };
}

export default function DeletePrompt({
  items,
  okay = 'Trash',
  cancel = 'Cancel',
  headline,
  onOkay,
  onCancel,
  parent,
}: Props): React.ReactElement {
  const { platform } = use(AppContext);
  const archiveCount = items.filter(it => !!it.info.archiveName).length;
  const realCount = items.length - archiveCount;
  const defaultHeadline = realCount === 1 && archiveCount === 0
    ? 'Trash this file?'
    : `Trash ${realCount} file${realCount === 1 ? '' : 's'}?`;
  const headlineText = headline ?? defaultHeadline;
  const note = archiveCount > 0
    ? ` (${archiveCount} archive entr${archiveCount === 1 ? 'y' : 'ies'} cannot be trashed and will be skipped)`
    : '';

  return (
    <Modal parent={parent}>
      <div className="dialog delete-prompt">
        <div className="msg">{headlineText}{note}</div>
        <div className="delete-list">
          {items.map((item) => {
            const tag = archiveTag(item.info);
            return (
              <div key={item.filename} className={`delete-item${tag ? ' delete-item-archive' : ''}`}>
                <div className="delete-thumb-cell">
                  <div className="delete-thumb" style={thumbStyle(item.info, platform.fileToUrl)} />
                </div>
                <div className="delete-name">
                  {tag && <span className="delete-tag">🚫 {tag} </span>}
                  {item.filename}
                </div>
              </div>
            );
          })}
        </div>
        <div className="options">
          <button type="button" onClick={onCancel}>{cancel}</button>
          <button
            type="button"
            onClick={onOkay}
            disabled={realCount === 0}
          >
            {okay}
          </button>
        </div>
      </div>
    </Modal>
  );
}
