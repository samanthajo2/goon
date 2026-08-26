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

import { shell } from '../../lib/electron-imports.js';
import { otherWindowIPC } from '../../lib/electron-renderer-imports.js';
import * as win from '../../lib/window-commands.js';
import React from 'react';
import fs from 'fs';
import path from 'path';
import '../../lib/stacktrace-log.js';
import bind from '../../lib/bind.js';
import debug from '../../lib/debug.js';
import ListenerManager from '../../lib/listener-manager.js';
import { eventToAccelerator, acceleratorToDisplay } from '../../lib/keyrouter.js';
import Modal from '../../lib/ui/modal.js';
import { actions, ActionId } from '../../lib/actions.js';
import { defaultPrefs, Preferences, KeyConfig, ToolbarPosition } from './default-prefs.js';
import type { ChannelStream } from '../../lib/window-ipc.js';
import { computeKeyConflicts } from './key-conflicts.js';
import { CSSArray } from '../../lib/css-utils.js';
import Checkbox from '../../lib/ui/checkbox.js';
import Range from '../../lib/ui/range.js';
import LivePasswordEditor from '../../lib/ui/live-password-editor.js';
import { cloneDeep } from '../../lib/utils.js';

type PrefsOptions = {
  userDataDir: string;
  _?: string[];
};

type PrefsProps = {
  options: PrefsOptions;
};

type PrefsState = {
  prefs: Preferences;
  // False until main answers requestPrefsForEditing. The form stays hidden
  // until then so nobody can edit (and thereby save) placeholder defaults.
  prefsReceived: boolean;
  saveError: boolean;
};


async function getFolders(): Promise<string[] | undefined> {
  const { canceled, filePaths } = await win.showOpenDialog({
    title: 'Select Folder',
    properties: ['openDirectory'],
  });
  return canceled ? undefined : filePaths;
}

// ---------- BaseFolder ----------

type BaseFolderProps = {
  foldername: string;
  ndx: number;
  setFolder: (foldername: string, ndx: number) => void;
  deleteFolder: (ndx: number) => void;
};

type BaseFolderState = {
  exists: boolean;
};

class BaseFolder extends React.Component<BaseFolderProps, BaseFolderState> {
  private _logger: ReturnType<typeof debug>;
  private _unmounted = false;
  private _checking = false;
  private _listenerManager: ListenerManager;

  constructor(props: BaseFolderProps) {
    super(props);
    bind(this, '_checkExists', '_checkVisibility');
    this.state = { exists: false };
    this._logger = debug('BaseFolder', props.foldername);
    this._listenerManager = new ListenerManager();
  }

  componentDidMount(): void {
    const on = this._listenerManager.on.bind(this._listenerManager);
    on(document, 'visibilitychange', this._checkVisibility);
    this._checkExists();
  }

  componentWillUnmount(): void {
    this._unmounted = true;
    this._listenerManager.removeAll();
  }

  _checkVisibility(): void {
    if (!document.hidden) {
      this._checkExists();
    }
  }

  _checkExists(): void {
    if (this._unmounted || document.hidden || this._checking) {
      return;
    }
    this._checking = true;
    fs.stat(this.props.foldername, (err, stat) => {
      if (this._unmounted) {
        return;
      }
      const exists = !!(stat && stat.isDirectory());
      this.setState({ exists });
      this._logger(this.props.foldername, exists);
      this._checking = false;
      setTimeout(this._checkExists, 2000);
    });
  }

  render(): React.ReactNode {
    const { foldername, ndx } = this.props;
    const classes = new CSSArray('basefolder');
    classes.addIf(!this.state.exists, 'missing');
    return (
      <div className={classes.toString()}>
        <div onClick={() => { this.props.setFolder(foldername, ndx); }}>  { }
          <pre>{foldername}</pre>
        </div>
        <button type="button" onClick={() => { this.props.setFolder(foldername, ndx); }}>...</button>
        <button type="button" onClick={() => { this.props.deleteFolder(ndx); }}>Del</button>
      </div>
    );
  }
}

// ---------- ActionSelector ----------

type ActionSelectorProps = {
  items: typeof actions;
  item: ActionId;
  onChange: React.ChangeEventHandler<HTMLSelectElement>;
};

const ActionSelector = ({ items, item, onChange }: ActionSelectorProps): React.ReactElement => (
  <select value={item} onChange={onChange}>
    {(Object.keys(items) as ActionId[]).map((actionId) => {
      const action = actions[actionId];
      return (
        <option key={actionId} value={actionId}>{`${actionId}: ${action.desc}`}</option>
      );
    })}
  </select>
);

// ---------- EnumSelector ----------

type EnumItem = { desc: string };

type EnumSelectorProps = {
  desc: string;
  items: Record<string, EnumItem>;
  item: string;
  onChange: (value: string) => void;
};

const EnumSelector = ({ desc, items, item, onChange }: EnumSelectorProps): React.ReactElement => (
  <div className="enum-select">
    <div>{desc}</div>
    <select value={item} onChange={(e) => { onChange(e.target.value); }}>
      {Object.keys(items).map((key) => (
        <option key={key} value={key}>{items[key].desc}</option>
      ))}
    </select>
  </div>
);

// ---------- Key ----------

type KeyProps = {
  keyConfig: KeyConfig;
  // Human-readable labels of the other bindings this one conflicts with (empty = none).
  conflicts: string[];
  deleteKey: () => void;
  setAccelerator: (accelerator: string) => void;
  setKeyAction: (action: ActionId) => void;
};

type KeyState = {
  setKey: boolean;
};

class Key extends React.Component<KeyProps, KeyState> {
  private _oldAccelerator?: string;

  constructor(props: KeyProps) {
    super(props);
    bind(this, '_captureKey', '_startKeyCapture', '_setAction', '_setKeyCapture', '_abortKeyCapture');
    this.state = { setKey: false };
  }

  _startKeyCapture(): void {
    this._oldAccelerator = this.props.keyConfig.accelerator;
    this.setState({ setKey: true });
    window.addEventListener('keydown', this._captureKey);
  }

  _captureKey(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const accel = eventToAccelerator(event);
    if (accel) this.props.setAccelerator(accel);
  }

  _setKeyCapture(): void {
    this._stopKeyCapture();
  }

  _abortKeyCapture(): void {
    if (this._oldAccelerator !== undefined) {
      this.props.setAccelerator(this._oldAccelerator);
    }
    this._stopKeyCapture();
  }

  _stopKeyCapture(): void {
    window.removeEventListener('keydown', this._captureKey);
    this.setState({ setKey: false });
  }

  _setAction(event: React.ChangeEvent<HTMLSelectElement>): void {
    this.props.setKeyAction(event.target.value as ActionId);
  }

  render(): React.ReactNode {
    const { keyConfig, conflicts, deleteKey } = this.props;
    const dup = conflicts.length > 0;
    const classes = new CSSArray('key');
    classes.addIf(dup, 'dup');
    const display = acceleratorToDisplay(keyConfig.accelerator);

    const setKeyDialog = this.state.setKey ? (
      <Modal>
        <div className="keypress">
          <div>Press A Key</div>
          <div>Key: {display}</div>
          <button type="button" onClick={this._setKeyCapture}>Set</button>
          <button type="button" onClick={this._abortKeyCapture}>Cancel</button>
        </div>
      </Modal>
    ) : undefined;

    return (
      <div className={classes.toString()}>
        {setKeyDialog}
        <div>
          <div
            className="keycode"
            onClick={this._startKeyCapture}
            title={dup ? `Conflicts with: ${conflicts.join(', ')}` : undefined}
          >{display}</div>
          <ActionSelector items={actions} item={keyConfig.action ?? 'noop'} onChange={this._setAction} />
        </div>
        <button type="button" onClick={this._startKeyCapture}>Set</button>
        <button type="button" onClick={() => { deleteKey(); }}>Del</button>
        {dup ? (
          <div className="key-conflict">conflicts with: {conflicts.join(', ')}</div>
        ) : undefined}
      </div>
    );
  }
}


const s_toolbarPositionModes: Record<ToolbarPosition, EnumItem> = {
  top:        { desc: 'top' },
  bottom:     { desc: 'bottom' },
  swapTop:    { desc: 'opposite from menu or top' },
  swapBottom: { desc: 'opposite from menu or bottom' },
};

// ---------- Prefs ----------

export default class Prefs extends React.Component<PrefsProps, PrefsState> {
  private _stream: ChannelStream | null = null;
  private _closed = false;

  constructor(props: PrefsProps) {
    super(props);
    bind(
      this,
      '_cleanup',
      '_makeFolder',
      '_addFolder',
      '_setFolder',
      '_deleteFolder',
      '_addKey',
      '_setAccelerator',
      '_setKeyAction',
      '_deleteKey',
      '_setPassword',
      '_changeToolbarPosition',
      '_browseExternalViewer',
      '_clearExternalViewer',
    );
    // Main owns prefs.json now (main/prefs-service.ts); this window is one more
    // subscriber on the 'prefs' channel that happens to be able to edit them.
    this.state = { prefs: cloneDeep(defaultPrefs), prefsReceived: false, saveError: false };
    otherWindowIPC.createChannelStream('prefs')
      .then((stream) => {
        if (this._closed) {
          stream.close();
          return;
        }
        this._stream = stream;
        stream.on('prefs', (prefs: Preferences) => {
          this.setState({ prefs, prefsReceived: true });
        });
        stream.on('saveError', (failed: boolean) => {
          this.setState({ saveError: failed });
        });
        // Ask for the raw stored prefs rather than the effective ones: a
        // `goon somedir` folder override must not be shown here, or saving
        // would write those folders into prefs.json. Pull-based so the
        // listeners above are wired before anything arrives.
        stream.send('requestPrefsForEditing');
      })
      .catch((err) => {
        console.error('could not connect to prefs:', err);
      });
    window.addEventListener('beforeunload', this._cleanup);
  }

  componentWillUnmount(): void {
    this._cleanup();
  }

  // Every edit in this window funnels through here: update locally so typing
  // stays responsive, and hand the new prefs to main, which persists them and
  // broadcasts to everyone else. Main deliberately does not echo a setPrefs
  // back to its author, so there's no round-trip to race the next keystroke.
  _updateState(newState: Partial<PrefsState>): void {
    this.setState(newState as PrefsState);
    if (newState.prefs) {
      this._stream?.send('setPrefs', newState.prefs);
    }
  }

  _cleanup(): void {
    this._closed = true;
    this._stream?.close();
    this._stream = null;
  }


  _updateBoolState(p: keyof Preferences, key: string, event: React.ChangeEvent<HTMLInputElement>): void {
    const prefs = this.state.prefs;
    const mod = { prefs: cloneDeep(prefs) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mod.prefs[p] as any)[key] = event.target.checked;
    this._updateState(mod);
  }

  _updateNumberState(p: keyof Preferences, key: string, event: React.ChangeEvent<HTMLInputElement>): void {
    const prefs = this.state.prefs;
    const mod = { prefs: cloneDeep(prefs) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mod.prefs[p] as any)[key] = event.target.value as unknown as number | 0;
    this._updateState(mod);
  }

  _makeCheckbox(p: keyof Preferences, fieldname: string, desc: string): React.ReactNode {
    const prefs = this.state.prefs;
    return (
      <Checkbox
        key={`checkbox-${fieldname}`}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        checked={(prefs[p] as any)[fieldname]}
        onUpdate={(event) => { this._updateBoolState(p, fieldname, event); }}
        label={desc}
      />
    );
  }

  _makeRange(p: keyof Preferences, fieldname: string, desc: string, options: { min: number; max: number }): React.ReactNode {
    const prefs = this.state.prefs;
    return (
      <Range
        key={`range-${fieldname}`}
        onUpdate={(event) => { this._updateNumberState(p, fieldname, event); }}
        label={desc}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        value={(prefs[p] as any)[fieldname]}
        min={options.min}
        max={options.max}
      />
    );
  }

  _makeFolder(foldername: string, ndx: number): React.ReactNode {
    return (
      <BaseFolder
        key={`folder-${ndx}`}
        foldername={foldername}
        ndx={ndx}
        setFolder={(...args) => { this._setFolder(...args); }}
        deleteFolder={(...args) => { this._deleteFolder(...args); }}
      />
    );
  }

  async _addFolder(): Promise<void> {
    const folders = await getFolders();
    if (folders) {
      const prefs = this.state.prefs;
      this._updateState({ prefs: { ...prefs, folders: [...prefs.folders, ...folders] } });
    }
  }

  async _setFolder(_foldername: string, ndx: number): Promise<void> {
    const folders = await getFolders();
    if (folders) {
      const prefs = this.state.prefs;
      this._updateState({
        prefs: {
          ...prefs,
          folders: [
            ...prefs.folders.slice(0, ndx),
            folders[0],
            ...prefs.folders.slice(ndx + 1),
          ],
        },
      });
    }
  }

  _deleteFolder(ndx: number): void {
    const prefs = this.state.prefs;
    const newFolders = [...prefs.folders.slice(0, ndx), ...prefs.folders.slice(ndx + 1)];
    this._updateState({ prefs: { ...prefs, folders: newFolders } });
  }

  _addKey(): void {
    const prefs = this.state.prefs;
    this._updateState({
      prefs: { ...prefs, keyConfig: [...prefs.keyConfig, { accelerator: '', action: 'noop' as ActionId }] },
    });
  }

  _setKeyAction(ndx: number, action: ActionId): void {
    const prefs = this.state.prefs;
    const keys = [...prefs.keyConfig];
    keys[ndx] = { ...keys[ndx], action };
    this._updateState({ prefs: { ...prefs, keyConfig: keys } });
  }

  _setAccelerator(ndx: number, accelerator: string): void {
    const prefs = this.state.prefs;
    const keys = [...prefs.keyConfig];
    keys[ndx] = { ...keys[ndx], accelerator };
    this._updateState({ prefs: { ...prefs, keyConfig: keys } });
  }

  _deleteKey(ndx: number): void {
    const prefs = this.state.prefs;
    const newKeys = [...prefs.keyConfig.slice(0, ndx), ...prefs.keyConfig.slice(ndx + 1)];
    this._updateState({ prefs: { ...prefs, keyConfig: newKeys } });
  }

  _makeKeys(): React.ReactNode[] {
    const prefs = this.state.prefs;
    const conflicts = computeKeyConflicts(prefs.keyConfig);
    return prefs.keyConfig.map((cfg, ndx) => (
      <Key
        key={`key-${ndx}`}  // eslint-disable-line
        conflicts={conflicts[ndx]}
        keyConfig={cfg}
        setAccelerator={(accel) => { this._setAccelerator(ndx, accel); }}
        setKeyAction={(action) => { this._setKeyAction(ndx, action); }}
        deleteKey={() => { this._deleteKey(ndx); }}
      />
    ));
  }

  _addErrors(): React.ReactNode {
    return this.state.saveError ? (
      <fieldset className="error">
        <legend>Errors</legend>
        <div>Could not save preferences to {path.join(this.props.options.userDataDir, 'prefs.json')}</div>
      </fieldset>
    ) : undefined;
  }

  _setPassword(password: string): void {
    const prefs = this.state.prefs;
    const mod = { prefs: cloneDeep(prefs) };
    mod.prefs.misc.password = password;
    this._updateState(mod);
  }

  _changeToolbarPosition(newPosition: string): void {
    const prefs = this.state.prefs;
    const mod = { prefs: cloneDeep(prefs) };
    mod.prefs.misc.toolbarPosition = newPosition as ToolbarPosition;
    this._updateState(mod);
  }

  async _browseExternalViewer(): Promise<void> {
    const { canceled, filePaths } = await win.showOpenDialog({
      title: 'Select External Viewer Executable',
      properties: ['openFile'],
    });
    if (!canceled && filePaths.length) {
      const prefs = this.state.prefs;
      const mod = { prefs: cloneDeep(prefs) };
      mod.prefs.misc.externalViewerPath = filePaths[0];
      this._updateState(mod);
    }
  }

  _clearExternalViewer(): void {
    const prefs = this.state.prefs;
    const mod = { prefs: cloneDeep(prefs) };
    mod.prefs.misc.externalViewerPath = '';
    this._updateState(mod);
  }

  render(): React.ReactNode {
    const prefs = this.state.prefs;
    // Until main answers, `prefs` is still the placeholder defaults. Rendering
    // the form now would let a fast click edit — and thereby save — values that
    // aren't the user's.
    if (!this.state.prefsReceived) {
      return <div className="prefs" />;
    }
    return (
      <div className="prefs">
        <fieldset>
          <legend><div>Preferences</div></legend>
          {this._addErrors()}
          <fieldset>
            <legend>Folders</legend>
            <div>
              {prefs.folders.map(this._makeFolder)}
              <button type="button" onClick={this._addFolder}>Add Folder</button>
            </div>
          </fieldset>
          <fieldset>
            <legend><div>Password</div></legend>
            <div>
              <LivePasswordEditor
                hasPassword={!!prefs.misc.password}
                onChange={this._setPassword}
              />
            </div>
          </fieldset>
          <fieldset>
            <legend>Keys</legend>
            <div>
              {this._makeKeys()}
              <button type="button" onClick={this._addKey}>Add Key</button>
            </div>
          </fieldset>
          <fieldset>
            <legend>Misc</legend>
            <div>
              {this._makeCheckbox('misc', 'fullPathOnSeparator', 'Show full folder paths')}
              {this._makeCheckbox('misc', 'indentByFolderDepth', 'Indent folders by depth')}
              {this._makeCheckbox('misc', 'gaplessDividers', 'Gapless dividers between views')}
              {this._makeCheckbox('misc', 'showEmpty', 'Show empty folders')}
              {this._makeCheckbox('misc', 'showEmptyIfChildNotEmpty', 'Show empty parent folders that have non-empty descendants')}
              {this._makeCheckbox('misc', 'scanContinuously', 'Continuously watch for changes')}
              {this._makeCheckbox('misc', 'showThumber', 'Show Thumbnails as they are made')}
              {this._makeCheckbox('misc', 'showBad', 'Show Thumbnails for images/videos that could not load')}
              {this._makeCheckbox('misc', 'filterSmallImages', 'Filter small images and videos')}
              {this._makeCheckbox('misc', 'checkForUpdates', 'Automatically check for updates')}
              {this._makeCheckbox('misc', 'showDates', 'Show dates when hovering over image')}
              {this._makeCheckbox('misc', 'showDimensions', 'Show dimensions when hovering over image')}
              {this._makeCheckbox('misc', 'showCaptureWatermark', 'Show watermark when recording')}
              {this._makeCheckbox('misc', 'promptOnDeleteFile', 'Prompt before deleting a file')}
              {this._makeCheckbox('misc', 'promptOnDeleteFolder', 'Prompt before deleting a folder')}
              {this._makeCheckbox('misc', 'enableWeb', 'Turn on local web server on startup')}
              <EnumSelector desc="Toolbar Position" items={s_toolbarPositionModes} item={prefs.misc.toolbarPosition} onChange={this._changeToolbarPosition} />
              <div className="external-viewer-path">
                <div>External Viewer</div>
                <div>
                  <pre>{prefs.misc.externalViewerPath || '(none)'}</pre>
                  <button type="button" onClick={this._browseExternalViewer}>Browse</button>
                  {prefs.misc.externalViewerPath && (
                    <button type="button" onClick={this._clearExternalViewer}>Clear</button>
                  )}
                </div>
              </div>
            </div>
          </fieldset>
          <fieldset>
            <legend>Video</legend>
            <div>
              {this._makeRange('misc', 'stepForwardDuration', 'Step Forward Duration (secs)', {min: 1, max: 300})}
              {this._makeRange('misc', 'stepBackwardDuration', 'Step Backward Duration (secs)', {min: 1, max: 300})}
            </div>
          </fieldset>
          <fieldset>
            <legend>Slideshow Item Duration (secs)</legend>
            <div>
              {this._makeRange('slideshowDuration', 'image', 'jpeg/png', {min: 1, max: 300})}
              {this._makeRange('slideshowDuration', 'image/gif', 'gif', {min: 1, max: 300})}
              {this._makeRange('slideshowDuration', 'video', 'video', {min: 1, max: 300})}
              {/* this._makeRange('slideshowDuration', 'default', 'other (not used)') */}
            </div>
          </fieldset>
          {/*
          <fieldset>
            <legend>Thumbnails</legend>
            <div>
              {this._makeRange('thumbnails', 'scanSize', 'Creation Size', {min: 64, max: 256})}
            </div>
          </fieldset>
          */}
          <fieldset>
            <legend>Extra</legend>
            <div>
              <button
                type="button"
                onClick={async () => {
                  await shell.openPath(this.props.options.userDataDir);
                }}
              >
                Open Cache in Explorer/Finder
              </button>
            </div>
          </fieldset>
        </fieldset>
      </div>
    );
  }
}
