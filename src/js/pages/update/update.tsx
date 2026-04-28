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
import { createRoot } from 'react-dom/client';
import { ipcRenderer } from '../../lib/electron-imports.js';
import bind from '../../lib/bind.js';
import debug from '../../lib/debug.js';
import '../../lib/stacktrace-log.js';   
import '../../lib/title.js';
import Modal from '../../lib/ui/modal.js';
import ListenerManager from '../../lib/listener-manager.js';

type StateKey = 'idle' | 'requested' | 'checking' | 'available' | 'downloading' | 'error' | 'noUpdate' | 'readyToUpdate' | 'quitting';

type StateInfo = {
  canTry?: boolean;
  canUpdate?: boolean;
  restart?: boolean;
  msg: string;
};

const states: Record<StateKey, StateInfo> = {
  idle:          { canTry: true,                  msg: '', },
  requested:     {                                msg: 'update requested', },
  checking:      {                                msg: 'checking for update', },
  available:     {                canUpdate: true, msg: 'update available', },
  downloading:   {                                msg: 'downloading...', },
  error:         { canTry: true,                  msg: 'error checking for update', },
  noUpdate:      { canTry: true,                  msg: 'no update available', },
  readyToUpdate: { restart: true,                 msg: 'update downloaded', },
  quitting:      {                                msg: '...quitting...', },
};

type DownloadProgress = {
  transferred?: number;
  total?: number;
};

type UpdateState = {
  state: StateKey;
  error: string;
  progress: DownloadProgress | null;
  availableVersion: string;
};

function toString(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    //
  }
  return v ? String(v) : '';
}

class Update extends React.Component<Record<string, never>, UpdateState> {
  private _logger: ReturnType<typeof debug>;
  private _listenerManager: ListenerManager;

  constructor(props: Record<string, never>) {
    super(props);
    this._logger = debug('Update');
    bind(
      this,
      '_handleError',
      '_handleCheckingForUpdate',
      '_handleUpdateAvailable',
      '_handleUpdateNotAvailable',
      '_handleUpdateDownloaded',
      '_handleDownloadProgress',
      '_checkForUpdate',
      '_downloadUpdate',
      '_quitAndUpdate',
    );
    this.state = {
      state: 'idle',
      error: '',
      progress: null,
      availableVersion: '',
    };
    this._listenerManager = new ListenerManager();
  }

  componentDidMount(): void {
    const on = this._listenerManager.on.bind(this._listenerManager);
    on(ipcRenderer, 'error', this._handleError);
    on(ipcRenderer, 'checking-for-update', this._handleCheckingForUpdate);
    on(ipcRenderer, 'update-available', this._handleUpdateAvailable);
    on(ipcRenderer, 'update-not-available', this._handleUpdateNotAvailable);
    on(ipcRenderer, 'update-downloaded', this._handleUpdateDownloaded);
    on(ipcRenderer, 'download-progress', this._handleDownloadProgress);
    this._checkForUpdate();
  }

  get updateState(): StateKey {
    return this.state.state;
  }

  set updateState(state: StateKey) {
    this.setState({ state });
  }

  _checkForUpdate(force = false): void {
    this.updateState = 'requested';
    this.setState({ error: '' });
    ipcRenderer.send('checkForUpdate', force);
  }

  _handleError(_e: unknown, err: unknown): void {
    this.setState({ error: toString(err), progress: null });
    this.updateState = 'error';
  }

  _handleCheckingForUpdate(): void {
    this.updateState = 'checking';
  }

  _handleUpdateAvailable(_e: unknown, info: { version?: string }): void {
    this.setState({ state: 'available', availableVersion: info?.version ?? '' });
  }

  _handleUpdateNotAvailable(): void {
    this.updateState = 'noUpdate';
    this.setState({ progress: null });
  }

  _handleUpdateDownloaded(e: unknown): void {
    this._logger(e);
    this.updateState = 'readyToUpdate';
  }

  _handleDownloadProgress(_e: unknown, progress: DownloadProgress): void {
    this.setState({ progress });
  }

  _downloadUpdate(): void {
    this.updateState = 'downloading';
    ipcRenderer.send('downloadUpdate');
  }

  _quitAndUpdate(): void {
    this.updateState = 'quitting';
    ipcRenderer.send('quitAndInstall');
  }

  /* eslint indent: "off" */
  render(): React.ReactNode {
    const state = states[this.updateState];
    const { progress, error, availableVersion } = this.state;
    const msg = (this.updateState === 'available' && availableVersion)
      ? `version ${availableVersion} is available`
      : state.msg;
    return (
      <Modal>
        <div className="msg update">
          <h1>Update</h1>
          <div className="status">
            <div>status: {msg}</div>
            {(progress && progress.transferred && progress.total)
              ? <div>{progress.transferred} / {progress.total}</div>
              : undefined
            }
          </div>
          {error
            ? <div className="error">{error}</div>
            : undefined
          }
          {state.canTry
            ? <div><button type="button" onClick={() => { this._checkForUpdate(true); }}>Check for Update</button></div>
            : undefined
          }
          {state.canUpdate
            ? <div><button type="button" onClick={this._downloadUpdate}>Update Now</button></div>
            : undefined
          }
          {state.restart
            ? <div><button type="button" onClick={this._quitAndUpdate}>Quit and Update</button></div>
            : undefined
          }
        </div>
      </Modal>
    );
  }
}

ipcRenderer.on('start', (/* event, args */) => {
  createRoot(document.querySelector('.browser')!).render(
    <Update />,
  );
});
ipcRenderer.send('start');
