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
import {ipcRenderer} from 'electron';  // eslint-disable-line
import {shell} from 'electron';  // eslint-disable-line
import {ContextMenu, MenuItem} from '../../lib/ui/context-menu';
import bind from '../../lib/bind';
import debug from '../../lib/debug';
import ForwardableEvent from '../../lib/forwardable-event';

const logger = debug('FolderContextMenu');
function showItem(filename, archive) {
  logger('show item:', filename);
  if (archive) {
    ipcRenderer.send('showItemInFolder', filename);
  } else {
    ipcRenderer.send('openPath', filename);
  }
}

export default class FolderContextMenu extends React.Component {
  constructor(props) {
    super(props);
    bind(
      this,
      '_handleOpen',
      '_handleDelete',
      '_handleRefreshFolder',
      '_handleSyncFolderView',
    );
    this._logger = debug('FolderContextMenu');
  }
  _handleOpen() {
    showItem(this.props.folder.filename, this.props.folder.archive);
  }
  _handleDelete() {
    this.props.eventBus.dispatch(new ForwardableEvent('deleteFolder'), this.props.folder);
  }
  _handleRefreshFolder() {
    this.props.eventBus.dispatch(new ForwardableEvent('refreshFolder'), this.props.folder.filename);
  }
  _handleSyncFolderView() {
    this.props.eventBus.dispatch(new ForwardableEvent('scrollFolderViewToFile'), this.props.folder.filename);
  }
  render() {
    return (
      <ContextMenu
        id="folderContextMenu"
        rotateMode={this.props.rotateMode}
      >
        <MenuItem onClick={this._handleOpen}>
          Show in Finder/Explorer
        </MenuItem>
        <MenuItem onClick={this._handleDelete}>
          Trash {this.props.folder ? this.props.folder.filename : ''}
        </MenuItem>
        <MenuItem onClick={this._handleRefreshFolder}>
          Refresh
        </MenuItem>
        <MenuItem onClick={this._handleSyncFolderView}>
          Sync Folder View
        </MenuItem>
      </ContextMenu>
    );
  }
}
