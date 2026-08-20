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
import { ContextMenu, MenuItem } from '../../lib/ui/context-menu.js';
import debug from '../../lib/debug.js';
import ForwardableEvent from '../../lib/forwardable-event.js';
import { FolderContextInfo } from './viewer-events.js';
import { AppContext } from './contexts.js';
import { isVirtualFolderKey } from '../thumber/virtual-folder-key.js';

const logger = debug('FolderContextMenu');

type Props = {
  folder: FolderContextInfo;
  rotateMode: number;
};

export default class FolderContextMenu extends React.Component<Props> {
  static contextType = AppContext;
  declare context: React.ContextType<typeof AppContext>;
  private _handleCopy = (): void => {
    this.context.eventBus.dispatch(new ForwardableEvent('copyFolder'), this.props.folder);
  };

  private _handleOpen = (): void => {
    const { filename, archive } = this.props.folder;
    logger('show item:', filename);
    if (archive) {
      this.context.platform.showItemInFolder?.(filename);
    } else {
      this.context.platform.openPath?.(filename);
    }
  };

  private _handleDelete = (): void => {
    this.context.eventBus.dispatch(new ForwardableEvent('deleteFolder'), this.props.folder);
  };

  private _handleCreateFolder = (): void => {
    this.context.eventBus.dispatch(new ForwardableEvent('createFolder'), this.props.folder);
  };

  private _handleRename = (): void => {
    this.context.eventBus.dispatch(new ForwardableEvent('renameFolder'), this.props.folder);
  };

  private _handleRefreshFolder = (): void => {
    this.context.eventBus.dispatch(new ForwardableEvent('refreshFolder'), this.props.folder.filename);
  };

  private _handleSyncFolderView = (): void => {
    this.context.eventBus.dispatch(
      new ForwardableEvent('scrollFolderViewToFile'),
      this.props.folder.filename,
    );
  };

  render(): React.ReactNode {
    const { platform } = this.context;
    // A virtual folder has no real path — Finder/Copy-Path don't apply, and its
    // "delete" removes the virtual folder itself (not any files on disk).
    const isVirtual = isVirtualFolderKey(this.props.folder?.filename ?? '');
    const canShowInFinder = !isVirtual && (platform.showItemInFolder || platform.openPath);
    return (
      <ContextMenu id="folderContextMenu" rotateMode={this.props.rotateMode}>
        {canShowInFinder && (
          <MenuItem onClick={this._handleOpen}>Show in Finder/Explorer</MenuItem>
        )}
        {platform.deleteFolder && (
          <MenuItem onClick={this._handleCreateFolder}>
            {isVirtual ? 'New Virtual Folder' : 'New Folder'}
          </MenuItem>
        )}
        {platform.deleteFolder && !this.props.folder?.archive && (
          <MenuItem onClick={this._handleRename}>Rename…</MenuItem>
        )}
        {platform.deleteFolder && (
          <MenuItem onClick={this._handleDelete}>
            {isVirtual ? 'Delete Virtual Folder' : `Delete ${this.props.folder ? this.props.folder.filename : ''}`}
          </MenuItem>
        )}
        {!isVirtual && platform.showItemInFolder && (
          <MenuItem onClick={this._handleCopy}>Copy Folder Path</MenuItem>
        )}
        <MenuItem onClick={this._handleRefreshFolder}>Refresh</MenuItem>
        {!isVirtual && <MenuItem onClick={this._handleSyncFolderView}>Sync Folder View</MenuItem>}
      </ContextMenu>
    );
  }
}
