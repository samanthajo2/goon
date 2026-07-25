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
import * as path from '../../lib/path-helpers.js';
import { ContextMenu, MenuItem } from '../../lib/ui/context-menu.js';
import debug from '../../lib/debug.js';
import ForwardableEvent from '../../lib/forwardable-event.js';
import { DBFileInfo } from './folder-db.js';
import { AppContext } from './contexts.js';
import { getSelected } from './selection-state.js';

const logger = debug('FileContextMenu');

type Props = {
  file: DBFileInfo;
  rotateMode: number;
};

export default class FileContextMenu extends React.Component<Props> {
  static contextType = AppContext;
  declare context: React.ContextType<typeof AppContext>;
  private _handleCopy = (): void => {
    this.context.eventBus.dispatch(new ForwardableEvent('copyFile'), this.props.file);
  };

  private _handleOpen = (): void => {
    const filename = this.props.file.archiveName ?? this.props.file.filename!;
    logger('show item:', filename);
    this.context.platform.showItemInFolder?.(filename);
  };

  private _handleInfo = (): void => {
    this.context.eventBus.dispatch(new ForwardableEvent('showFileInfo'), this.props.file);
  };

  private _handleDelete = (): void => {
    if (this.props.file.archiveName) {
      this.context.eventBus.dispatch(new ForwardableEvent('deleteFolder'), {
        filename: this.props.file.archiveName,
        archive: true,
      });
    } else {
      this.context.eventBus.dispatch(new ForwardableEvent('deleteFile'), this.props.file);
    }
  };

  private _handleRefreshFolder = (): void => {
    this.context.eventBus.dispatch(
      new ForwardableEvent('refreshFolder'),
      path.dirname(this.props.file.filename),
    );
  };

  private _handleSyncFolderView = (): void => {
    this.context.eventBus.dispatch(
      new ForwardableEvent('scrollFolderViewToFile'),
      path.dirname(this.props.file.filename),
    );
  };

  private _deleteMenuItem(): React.ReactNode {
    if (!this.context.platform.deleteFile) return undefined;
    if (this.props.file && this.props.file.filename) {
      const sel = getSelected();
      const label = sel.has(this.props.file.filename) && sel.size > 1
        ? `Delete ${sel.size} selected items`
        : `Delete ${this.props.file.archiveName ?? this.props.file.filename}`;
      return (
        <MenuItem onClick={this._handleDelete}>
          {label}
        </MenuItem>
      );
    }
    return undefined;
  }

  render(): React.ReactNode {
    const { platform } = this.context;
    return (
      <ContextMenu id="fileContextMenu" rotateMode={this.props.rotateMode}>
        {platform.showItemInFolder && (
          <MenuItem onClick={this._handleOpen}>Show in Finder/Explorer</MenuItem>
        )}
        <MenuItem onClick={this._handleInfo}>Get Info</MenuItem>
        {this._deleteMenuItem()}
        <MenuItem onClick={this._handleRefreshFolder}>Refresh</MenuItem>
        {platform.showItemInFolder && (
          <MenuItem onClick={this._handleCopy}>Copy File Path</MenuItem>
        )}
        <MenuItem onClick={this._handleSyncFolderView}>Sync Folder View</MenuItem>
      </ContextMenu>
    );
  }
}
