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
import { ipcRenderer } from 'electron';   
import { ContextMenu, MenuItem } from '../../lib/ui/context-menu';
import debug from '../../lib/debug';
import ForwardableEvent from '../../lib/forwardable-event';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher';
import { FolderContextInfo } from './viewer-events';

const logger = debug('FolderContextMenu');

function showItem(filename: string, archive: boolean | undefined): void {
  logger('show item:', filename);
  if (archive) {
    ipcRenderer.send('showItemInFolder', filename);
  } else {
    ipcRenderer.send('openPath', filename);
  }
}

type Props = {
  eventBus: ForwardableEventDispatcher;
  folder: FolderContextInfo;
  rotateMode: number;
};

export default class FolderContextMenu extends React.Component<Props> {
  private _handleCopy = (): void => {
    this.props.eventBus.dispatch(new ForwardableEvent('copyFolder'), this.props.folder);
  };

  private _handleOpen = (): void => {
    showItem(this.props.folder.filename, this.props.folder.archive);
  };

  private _handleDelete = (): void => {
    this.props.eventBus.dispatch(new ForwardableEvent('deleteFolder'), this.props.folder);
  };

  private _handleRefreshFolder = (): void => {
    this.props.eventBus.dispatch(new ForwardableEvent('refreshFolder'), this.props.folder.filename);
  };

  private _handleSyncFolderView = (): void => {
    this.props.eventBus.dispatch(
      new ForwardableEvent('scrollFolderViewToFile'),
      this.props.folder.filename,
    );
  };

  render(): React.ReactNode {
    return (
      <ContextMenu id="folderContextMenu" rotateMode={this.props.rotateMode}>
        <MenuItem onClick={this._handleOpen}>Show in Finder/Explorer</MenuItem>
        <MenuItem onClick={this._handleDelete}>
          Trash {this.props.folder ? this.props.folder.filename : ''}
        </MenuItem>
        <MenuItem onClick={this._handleCopy}>Copy Folder Path</MenuItem>
        <MenuItem onClick={this._handleRefreshFolder}>Refresh</MenuItem>
        <MenuItem onClick={this._handleSyncFolderView}>Sync Folder View</MenuItem>
      </ContextMenu>
    );
  }
}
