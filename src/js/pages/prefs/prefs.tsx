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

import { ipcRenderer, shell } from '../../lib/electron-imports.js';
import { otherWindowIPC } from '../../lib/electron-renderer-imports.js';
import * as win from '../../lib/window-commands.js';
import React from 'react';
import fs from 'fs';
import path from 'path';
import keycode from 'keycode';
import '../../lib/stacktrace-log.js';
import bind from '../../lib/bind.js';
import debug from '../../lib/debug.js';
import ListenerManager from '../../lib/listener-manager.js';
import { eventToKeyInfo, keyInfoToId, keyInfoToString } from '../../lib/keyrouter.js';
import Modal from '../../lib/ui/modal.js';
import { actions, ActionId } from '../../lib/actions.js';
import { loadPrefs, Preferences, KeyConfig, ToolbarPosition } from './default-prefs.js';
import { CSSArray } from '../../lib/css-utils.js';
import Checkbox from '../../lib/ui/checkbox.js';
import Range from '../../lib/ui/range.js';
import LivePasswordEditor from '../../lib/ui/live-password-editor.js';
import { readUTF8FileSync, debounce, cloneDeep, CancelableFn } from '../../lib/utils.js';

type PrefsOptions = {
  userDataDir: string;
  _?: string[];
};

type PrefsProps = {
  options: PrefsOptions;
};

type PrefsState = {
  prefs: Preferences;
  saveError: boolean;
};

type KeyInfo = {
  keyCode: number;
  modifiers?: string;
  action?: ActionId;
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
  keyInfo: KeyInfo;
  dup: boolean;
  deleteKey: () => void;
  setKeyCode: (keyInfo: KeyInfo) => void;
  setKeyAction: (action: ActionId) => void;
};

type KeyState = {
  setKey: boolean;
};

class Key extends React.Component<KeyProps, KeyState> {
  private _oldKeyInfo?: KeyInfo;

  constructor(props: KeyProps) {
    super(props);
    bind(this, '_captureKey', '_startKeyCapture', '_setAction', '_setKeyCapture', '_abortKeyCapture');
    this.state = { setKey: false };
  }

  _startKeyCapture(): void {
    this._oldKeyInfo = cloneDeep(this.props.keyInfo);
    this.setState({ setKey: true });
    window.addEventListener('keydown', this._captureKey);
  }

  _captureKey(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.props.setKeyCode(eventToKeyInfo(event) as KeyInfo);
  }

  _setKeyCapture(): void {
    this._stopKeyCapture();
  }

  _abortKeyCapture(): void {
    if (this._oldKeyInfo) {
      this.props.setKeyCode(this._oldKeyInfo);
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
    const { keyInfo, dup, deleteKey } = this.props;
    const classes = new CSSArray('key');
    classes.addIf(dup, 'dup');

    const setKeyDialog = this.state.setKey ? (
      <Modal>
        <div className="keypress">
          <div>Press A Key</div>
          <div>Key: {keyInfoToString(keyInfo as Parameters<typeof keyInfoToString>[0])}</div>
          <button type="button" onClick={this._setKeyCapture}>Set</button>
          <button type="button" onClick={this._abortKeyCapture}>Cancel</button>
        </div>
      </Modal>
    ) : undefined;

    return (
      <div className={classes.toString()}>
        {setKeyDialog}
        <div>
          <div className="keycode" onClick={this._startKeyCapture}>{keyInfoToString(keyInfo as Parameters<typeof keyInfoToString>[0])}</div>
          <ActionSelector items={actions} item={keyInfo.action ?? 'noop'} onChange={this._setAction} />
        </div>
        <button type="button" onClick={this._startKeyCapture}>Set</button>
        <button type="button" onClick={() => { deleteKey(); }}>Del</button>
      </div>
    );
  }
}

// ---------- helpers ----------

function modifiersToString(keyInfo: KeyInfo): string[] {
  const mods = keyInfo.modifiers;
  const parts: string[] = [];
  if (mods) {
    if (mods.indexOf('c') >= 0) parts.push('ctrl');
    if (mods.indexOf('a') >= 0) parts.push('alt');
    if (mods.indexOf('s') >= 0) parts.push('shift');
    if (mods.indexOf('m') >= 0) parts.push('meta');
  }
  return parts;
}

const s_keySubs: Record<string, string> = {
  'left command': 'meta',
  'right command': 'meta',
};

function getKeyname(keyInfo: KeyInfo): string {
  const name = keycode(keyInfo.keyCode) as string;
  return s_keySubs[name] || name;
}

const s_mods: Record<string, boolean> = { shift: true, ctrl: true, alt: true, meta: true };

function isMod(keyInfo: KeyInfo): boolean {
  return !!s_mods[getKeyname(keyInfo)];
}

const s_toolbarPositionModes: Record<ToolbarPosition, EnumItem> = {
  top:        { desc: 'top' },
  bottom:     { desc: 'bottom' },
  swapTop:    { desc: 'opposite from menu or top' },
  swapBottom: { desc: 'opposite from menu or bottom' },
};

// ---------- Prefs ----------

export default class Prefs extends React.Component<PrefsProps, PrefsState> {
  private _streams: ReturnType<typeof otherWindowIPC.createChannel> extends Promise<infer S> ? S[] : never[] = [] as never[];
  private _ipc: ReturnType<typeof otherWindowIPC.createChannel> | null;
  private _prefsPath: string;
  private _savePrefs: CancelableFn;

  constructor(props: PrefsProps) {
    super(props);
    this._streams = [];
    bind(
      this,
      '_addStream',
      '_cleanup',
      '_sendStateToAllStreams',
      '_saveAndSendPrefs',
      '_makeFolder',
      '_addFolder',
      '_setFolder',
      '_deleteFolder',
      '_addKey',
      '_setKeyCode',
      '_setKeyAction',
      '_deleteKey',
      '_setPassword',
      '_changeToolbarPosition',
      '_browseExternalViewer',
      '_clearExternalViewer',
    );
    this._ipc = otherWindowIPC.createChannel('prefs');
    this._ipc.on('connect', this._addStream);
    this._prefsPath = path.join(props.options.userDataDir, 'prefs.json');
    this._savePrefs = debounce(this._savePrefsImpl.bind(this), 200);
    const { error, prefs } = loadPrefs(this._prefsPath, {
      existsSync: fs.existsSync,
      readUTF8FileSync,
    });
    this.state = { prefs, saveError: false };
    if (error) {
      this._savePrefs();
    }
    window.addEventListener('beforeunload', this._cleanup);
  }

  componentWillUnmount(): void {
    this._cleanup();
  }

  _updateState(newState: Partial<PrefsState>): void {
    this.setState(newState as PrefsState, this._saveAndSendPrefs);
  }

  _saveAndSendPrefs(): void {
    this._sendStateToAllStreams();
    this._savePrefs();
  }

  _savePrefsImpl(): void {
    try {
      fs.writeFile(this._prefsPath, JSON.stringify(this.state.prefs, null, 2), (err) => {
        this.setState({ saveError: !!err });
      });
    } catch {
      this.setState({ saveError: true });
    }
  }

  _cleanup(): void {
    if (this._ipc) {
      (this._streams as { close(): void }[]).slice().forEach((stream) => { stream.close(); });
      this._ipc.close();
      this._ipc = null;
    }
  }

  _addStream(stream: { on: (e: string, fn: () => void) => void; send: (e: string, ...a: unknown[]) => void; close: () => void }): void {
    stream.on('disconnect', () => { this._removeStream(stream); });
    (this._streams as typeof stream[]).push(stream);
    this._sendPrefs(stream, this._getPrefsToSend());
  }

  _removeStream(stream: unknown): void {
    const ndx = (this._streams as unknown[]).indexOf(stream);
    (this._streams as unknown[]).splice(ndx, 1);
  }

  _getPrefsToSend(): Preferences {
    let prefs = this.state.prefs;
    const dirs = this.props.options._;
    if (dirs && dirs.length) {
      prefs = Object.assign(JSON.parse(JSON.stringify(prefs)), { folders: dirs });
    }
    return prefs;
  }

  _sendPrefs(stream: { send: (e: string, ...a: unknown[]) => void }, prefs: Preferences): void {
    stream.send('prefs', prefs);
  }

  _sendStateToAllStreams(): void {
    const prefs = this._getPrefsToSend();
    ipcRenderer.send('prefs', prefs);
    (this._streams as { send: (e: string, ...a: unknown[]) => void }[]).forEach((stream) => {
      this._sendPrefs(stream, prefs);
    });
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
      prefs: { ...prefs, keyConfig: [...prefs.keyConfig, { keyCode: 0, action: 'noop' as ActionId }] },
    });
  }

  _setKeyAction(ndx: number, action: ActionId): void {
    const prefs = this.state.prefs;
    const keys = [...prefs.keyConfig];
    keys[ndx] = { ...keys[ndx], action };
    this._updateState({ prefs: { ...prefs, keyConfig: keys } });
  }

  _setKeyCode(ndx: number, keyInfo: KeyInfo): void {
    const prefs = this.state.prefs;
    const keys = [...prefs.keyConfig];
    keys[ndx] = { ...keys[ndx], ...keyInfo } as KeyConfig;
    this._updateState({ prefs: { ...prefs, keyConfig: keys } });
  }

  _deleteKey(ndx: number): void {
    const prefs = this.state.prefs;
    const newKeys = [...prefs.keyConfig.slice(0, ndx), ...prefs.keyConfig.slice(ndx + 1)];
    this._updateState({ prefs: { ...prefs, keyConfig: newKeys } });
  }

  _makeKeys(): React.ReactNode[] {
    const prefs = this.state.prefs;
    const counts: Record<string, number> = {};
    const keynames: Record<string, number> = {};
    const usedMods: Record<string, number> = {};

    prefs.keyConfig.forEach((keyInfo) => {
      const id = keyInfoToId({ ...keyInfo, modifiers: keyInfo.modifiers ?? '' });
      const keyname = getKeyname(keyInfo);
      const mods = modifiersToString(keyInfo);
      counts[id] = 1 + (counts[id] || 0);
      keynames[keyname] = 1 + (keynames[keyname] || 0);
      for (const mod of mods) {
        if (mod !== keyname) {
          usedMods[mod] = 1 + (usedMods[mod] || 0);
        }
      }
    });

    const isOneOfOurModsAssignedAsKey = (keyInfo: KeyInfo): boolean => {
      for (const mod of modifiersToString(keyInfo)) {
        if (keynames[mod]) return true;
      }
      return false;
    };

    return prefs.keyConfig.map((keyInfo, ndx) => {
      const id = keyInfoToId({ ...keyInfo, modifiers: keyInfo.modifiers ?? '' });
      const dup = counts[id] > 1;
      const modDup = isMod(keyInfo)
        ? usedMods[getKeyname(keyInfo)]
        : isOneOfOurModsAssignedAsKey(keyInfo);
      return (
        <Key
          key={`key-${ndx}`}  // eslint-disable-line
          dup={!!(dup || modDup)}
          keyInfo={keyInfo}
          setKeyCode={(...args) => { this._setKeyCode(ndx, ...args); }}
          setKeyAction={(...args) => { this._setKeyAction(ndx, ...args); }}
          deleteKey={(...args) => { this._deleteKey(ndx, ...args); }}
        />
      );
    });
  }

  _addErrors(): React.ReactNode {
    return this.state.saveError ? (
      <fieldset className="error">
        <legend>Errors</legend>
        <div>Could not save preferences to {this._prefsPath}</div>
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
              {this._makeCheckbox('misc', 'showEmpty', 'Show empty folders (hack, refresh view)')}
              {this._makeCheckbox('misc', 'scanContinuously', 'Continuously watch for changes')}
              {this._makeCheckbox('misc', 'showThumber', 'Show Thumbnails as they are made')}
              {this._makeCheckbox('misc', 'showBad', 'Show Thumbnails for images/videos that could not load')}
              {this._makeCheckbox('misc', 'filterSmallImages', 'Filter small images and videos')}
              {this._makeCheckbox('misc', 'checkForUpdates', 'Automatically check for updates')}
              {this._makeCheckbox('misc', 'showDates', 'Show dates when hovering over image')}
              {this._makeCheckbox('misc', 'showDimensions', 'Show dimensions when hovering over image')}
              {this._makeCheckbox('misc', 'promptOnDeleteFile', 'Prompt before deleting a file')}
              {this._makeCheckbox('misc', 'promptOnDeleteFolder', 'Prompt before deleting a folder')}
              {this._makeCheckbox('misc', 'enableWeb', 'Turn on local web server')}
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
