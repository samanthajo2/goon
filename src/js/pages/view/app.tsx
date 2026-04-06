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

import { rimraf } from 'rimraf';
import { ipcRenderer } from 'electron';   
import otherWindowIPC, { ChannelStream } from 'other-window-ipc';
import React from 'react';
import _ from 'lodash';
import { autorun, observable, action } from 'mobx';
import { observer } from 'mobx-react';
import { hideMenu, showMenu } from '../../lib/ui/context-menu';
import ActionEvent from '../../lib/action-event';
import ActionListener from '../../lib/action-listener';
import { getGenerationData } from '../../lib/metadata';
import SplitPane from '../../lib/ui/split-pane';
import FileContextMenu from './file-context-menu';
import FolderContextMenu from './folder-context-menu';
import FileInfo from './file-info';
import OkayCancel from '../../lib/ui/okay-cancel';
import Folders from './folders';
import { sortModes, FolderStateHelper, SortMode, FolderStateRoot } from './folder-state-helper';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher';
import ForwardableEvent from '../../lib/forwardable-event';
import { trashingFiles, addTrashingFile, removeTrashingFile } from './trashing-state';
import KeyRouter from '../../lib/keyrouter';
import debug from '../../lib/debug';
import { rotateModes } from '../../lib/rotatehelper';
import ImagegridsToolbar from './imagegrids-toolbar';
import ViewerToolbar from './viewer-toolbar';
import ViewSplitHolder from './view-split-holder';
import { makeActionFuncs, ActionId, Action } from '../../lib/actions';
import FolderDB from './folder-db';
import FolderFilter from './folder-filter';
import gridModes, { GridMode } from './grid-modes';
import { makeFilter, makeCompositeFilter } from '../../lib/make-filter';
import ToolbarHolder from './toolbar-holder';
import WaitForFiles from './wait-for-files';
import Loading from './loading';
import { setupFullscreen, toggleFullscreen } from '../../lib/fullscreen';
import MediaManagerClient from '../../lib/media-manager-client';
import { Preferences } from '../prefs/default-prefs';
import { DBFileInfo, DBFoldersByPath } from './folder-db';
import ViewSplit from './viewsplit';
import { ImagegridStateHolder, ViewerStateHolder } from './viewer-events';

function reload(): void {
  console.log('queue reload');
  setTimeout(() => {
    window.location.reload();
  }, 1000);
}

const dummyEvent = {
  preventDefault: () => {},
  stopPropagation: () => {},
};

const g_minSizes: Record<string, number> = {
  'image': 256,
  'image/gif': 128,
  'video': 128,
};

const s_toolbarModeBottomTable: Record<string, boolean> = {
  top: false,
  bottom: true,
  swapTop: false,
  swapBottom: true,
};

const s_rotateModeVsToolbarModeBottomTable: Record<number, Record<string, boolean>> = {
  0: { top: false, bottom: true, swapTop: true,  swapBottom: true  },
  1: { top: false, bottom: true, swapTop: false, swapBottom: true  },
  2: { top: false, bottom: true, swapTop: false, swapBottom: false },
  3: { top: false, bottom: true, swapTop: false, swapBottom: true  },
};

type WinState = {
  showUI: number;
  rotateMode: number;
  thumbnailZoom: number;
  sortMode: SortMode;
  gridMode: GridMode;
  splitPosition: number;
  splitStartPosition: number;
};

type FileInfoData = { filename: string; metaData: unknown } | string | null;

type AppState = {
  totalFiles: number;
  prefs: Partial<Preferences>;
  winState: WinState;
  contextFileInfo: DBFileInfo | null;
  contextFolderInfo: { filename: string; archive?: boolean } | null;
  fileInfo: FileInfoData;
  showDeleteFilePrompt: boolean;
  showDeleteFolderPrompt: boolean;
  showForceDelete?: boolean;
  forceDeleteFilename?: string;
  forceDeleteIsFolder?: boolean;
  filter: string;
  filterError: string;
  root: FolderStateRoot;
  newRoot?: FolderStateRoot;
  prefsReceived?: boolean;
};

type StartState = {
  winState?: Partial<WinState>;
  layout?: unknown;
};

type Props = {
  options: {
    columnWidth: number;
    padding: number;
    maxSeekTime: number;
  };
  startState?: StartState;
};

@observer
export default class App extends React.Component<Props, AppState> {
  private _logger: ReturnType<typeof debug>;
  private _folderDB: FolderDB;
  private _folderFilter: FolderFilter;
  private _newRoot: FolderStateRoot;
  private _actionFuncs: { [key in ActionId]: () => void };
  private _thumberStream: ChannelStream | null = null;
  private _prefsStream: ChannelStream | null = null;
  private _imagegridStateHolder: ImagegridStateHolder;
  private _viewerStateHolder: ViewerStateHolder;
  private _eventBus: ForwardableEventDispatcher;
  private _toolbarEventBus: ForwardableEventDispatcher;
  private _imageGridToolbarEventBus: ForwardableEventDispatcher;
  private _viewerToolbarEventBus: ForwardableEventDispatcher;
  private _keyRouter: KeyRouter;
  private _actionListener: ActionListener;
  private _saveLayout: _.DebouncedFunc<() => void>;
  private _setNewRoot: _.DebouncedFunc<() => void>;
  private _fileInfoMediaManager: MediaManagerClient;
  private _currentView: ViewSplit | null = null;
  private _filterInputActive = false;
  private _filterShowBad = false;
  private _filterSmallImages = false;
  private _folderStatePrefs: { showEmpty: boolean } = { showEmpty: false };
  private _folderFilterProcessQueued = false;
  private _haveBadFilter = false;
  private _pendingDeleteFileInfo: DBFileInfo | null = null;
  private _container: HTMLDivElement | null = null;

  constructor(props: Props) {
    super(props);
    const startWinState = props.startState?.winState ?? {};
    const winState: WinState = {
      showUI: 3,
      rotateMode: 0,
      thumbnailZoom: 1,
      sortMode: 'sortPath',
      gridMode: 'columns',
      splitPosition: 0.2,
      splitStartPosition: 0.2,
      ...startWinState,
    };
    if (startWinState.splitPosition) {
      winState.splitStartPosition = startWinState.splitPosition;
    }

    this.state = {
      totalFiles: 0,
      prefs: {},
      winState,
      contextFileInfo: null,
      contextFolderInfo: null,
      fileInfo: null,
      showDeleteFilePrompt: false,
      showDeleteFolderPrompt: false,
      filter: '',
      filterError: '',
      root: FolderStateHelper.createRoot(winState.sortMode),
    };

    this._logger = debug('App');
    this._saveLayout = _.debounce(this._doSaveLayout.bind(this), 250);
    this._setNewRoot = _.throttle(this._doSetNewRoot.bind(this), 150);
    this._fileInfoMediaManager = new MediaManagerClient();
    this._newRoot = FolderStateHelper.createRoot(winState.sortMode);

    this._folderDB = new FolderDB();
    this._folderDB.on('updateFiles', this._addFilesToFolderFilter);
    this._folderFilter = new FolderFilter();
    this._folderFilter.on('updateFiles', this._addFilesToFolderStateHelper);
    this._folderFilter.on('pending', this._queueFolderFilterProcess);

    this._actionFuncs = makeActionFuncs((action: Action) => {
      this._emitAction(action);
    });

    otherWindowIPC.createChannelStream('thumber')
      .then((stream) => {
        this._thumberStream = stream;
        this._thumberStream.on('updateFiles', this._addFilesToFolderDB);
        this._thumberStream.on('trashFailed', this._handleTrashFailed);
        this._thumberStream.on('disconnect', reload);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (err instanceof Error && err.stack) {
          console.error(err.stack);
        }
      });

    otherWindowIPC.createChannelStream('prefs')
      .then((stream) => {
        this._prefsStream = stream;
        this._prefsStream.on('prefs', this._updatePrefs);
        this._prefsStream.on('disconnect', reload);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (err instanceof Error && err.stack) {
          console.error(err.stack);
        }
      });

    this._imagegridStateHolder = observable({ state: null }) as unknown as ImagegridStateHolder;
    this._viewerStateHolder = observable({ state: null }) as unknown as ViewerStateHolder;

    this._eventBus = new ForwardableEventDispatcher();
    this._eventBus.debugId = this._logger.getPrefix();
    this._eventBus.on('action', this._handleActions);
    this._eventBus.on('fileContextMenu', this._handleFileContextMenu);
    this._eventBus.on('folderContextMenu', this._handleFolderContextMenu);
    this._eventBus.on('refreshFolder', this._handleRefreshFolder);
    this._eventBus.on('deleteFile', this._handleDeleteFile);
    this._eventBus.on('deleteFolder', this._handleDeleteFolder);
    this._eventBus.on('copyFile', this._handleCopyFile);
    this._eventBus.on('copyFolder', this._handleCopyFolder);
    this._eventBus.on('showFileInfo', this._handleShowFileInfo);

    this._toolbarEventBus = new ForwardableEventDispatcher();
    this._imageGridToolbarEventBus = new ForwardableEventDispatcher();
    this._viewerToolbarEventBus = new ForwardableEventDispatcher();
    this._toolbarEventBus.setForward(this._imageGridToolbarEventBus);

    autorun(() => {
      const viewing = this._viewerStateHolder.state && this._viewerStateHolder.state.viewing;
      this._toolbarEventBus.setForward(viewing
        ? this._viewerToolbarEventBus
        : this._imageGridToolbarEventBus);
    });

    this._keyRouter = new KeyRouter();
    window.addEventListener('keydown', this._handleKeyDown);

    this._actionListener = new ActionListener();
    this._actionListener.on('toggleUI', this._toggleUI);
    this._actionListener.on('rotate', this._handleRotate);
    this._actionListener.on('cycleSortMode', this._handleCycleSortMode);
    this._actionListener.on('cycleGridMode', this._handleCycleGridMode);
    this._actionListener.on('toggleFullscreen', toggleFullscreen);

    this._actionListener.on('newWindow', () => {
      ipcRenderer.send('openWindow', 'view');
    });
    this._actionListener.on('showHelp', () => {
      ipcRenderer.send('openWindow', 'help');
    });

    ipcRenderer.on('action', (_event, actionId: ActionId) => {
      this._eventBus.dispatch(new ActionEvent({ action: actionId }));
    });

    setupFullscreen();

    process.nextTick(() => {
      this._setFilter(() => true);
    });
  }

  componentDidMount(): void {
    // intentionally empty
  }

  componentWillUnmount(): void {
    this._actionListener.close();
    if (this._thumberStream) {
      this._thumberStream.close();
      this._thumberStream = null;
    }
  }

  private _doSaveLayout(): void {
    ipcRenderer.send('saveWinState', this.state.winState);
  }

  private _addFilesToFolderDB = (folders: DBFoldersByPath): void => {
    this._logger('addFilesToFolderDB', folders);
    this._folderDB.updateFiles(folders as never);
  };

  private _addFilesToFolderFilter = (folders: DBFoldersByPath): void => {
    this.setState({
      totalFiles: this._folderDB.totalFiles,
    });
    this._folderFilter.updateFiles(folders);
  };

  private _addFilesToFolderStateHelper = (folders: DBFoldersByPath): void => {
    FolderStateHelper.updateFolders(this._newRoot, folders as never, this._folderStatePrefs);
    this._setNewRoot();
  };

  private _doSetNewRoot(): void {
    this.setState({
      root: { ...this._newRoot },
    });
  }

  private _queueFolderFilterProcess = (): void => {
    if (!this._folderFilterProcessQueued) {
      this._folderFilterProcessQueued = true;
      process.nextTick(this._processFolderFilter);
    }
  };

  private _processFolderFilter = (): void => {
    this._folderFilterProcessQueued = false;
    if (this._folderFilter.process()) {
      this._queueFolderFilterProcess();
    }
  };

  private _setFilter(filter: (filename: string, fileInfo: DBFileInfo) => boolean): void {
    this._folderFilter.setFilter(makeCompositeFilter([this._goodFilter, this._smallDimensionsFilter, filter]));
    this._rerunFilter();
  }

  private _rerunFilter(): void {
    this._filterShowBad = !!(this.state.prefs.misc?.showBad || this._haveBadFilter);
    this._filterSmallImages = !!(this.state.prefs.misc?.filterSmallImages);
    this._folderStatePrefs = {
      showEmpty: !!(this.state.prefs.misc?.showEmpty),
    };
    this._newRoot = FolderStateHelper.createRoot(this.state.winState.sortMode);
    this._doSetNewRoot();
    this._folderDB.sendAll();
  }

  private _handleUpdateFilter = (filter: string): void => {
    const result = makeFilter(filter);
    this.setState({
      filter,
      filterError: result.error ?? '',
    });
    if (!result.error) {
      this._haveBadFilter = !!(result.filterTypesUsed?.bad);
      this._setFilter(result.filter);
    }
  };

  private _goodFilter = (_filename: string, fileInfo: DBFileInfo): boolean => {
    if (this._filterShowBad) {
      return true;
    }
    return !fileInfo.bad;
  };

  private _smallDimensionsFilter = (_filename: string, fileInfo: DBFileInfo): boolean => {
    if (!this._filterSmallImages) {
      return true;
    }
    let minSize = g_minSizes[fileInfo.type];
    if (!minSize) {
      if (!fileInfo.type) {
        return true;
      }
      const ndx = fileInfo.type.indexOf('/');
      if (ndx >= 0) {
        const type = fileInfo.type.substring(0, ndx);
        minSize = g_minSizes[type];
        if (!minSize) {
          return true;
        }
      }
    }
    const tooSmall = (fileInfo.width && fileInfo.width < minSize) || (fileInfo.height && fileInfo.height < minSize);
    return !tooSmall;
  };

  private _handleCycleSortMode = (): void => {
    this.setState((prevState) => ({
      winState: { ...prevState.winState, sortMode: sortModes.next(prevState.winState.sortMode) },
    }), () => {
      this._saveLayout();
      this._rerunFilter();
    });
  };

  private _handleCycleGridMode = (): void => {
    this.setState((prevState) => ({
      winState: { ...prevState.winState, gridMode: gridModes.next(prevState.winState.gridMode) },
    }), () => {
      this._saveLayout();
    });
  };

  @action private _setCurrentView = (view: ViewSplit | null): void => {
    this._currentView = view;
    this._eventBus.setForward(view ? view.getEventBus() : null);
    this._imagegridStateHolder.state = view ? view.getImagegridState() : null;
    this._viewerStateHolder.state = view ? view.getViewerState() : null;
  };

  private _toggleUI = (): void => {
    this.setState((prevState) => ({
      winState: { ...prevState.winState, showUI: (prevState.winState.showUI + 3) % 4 },
    }), () => {
      this._saveLayout();
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _handleActions = (event: any, ...args: unknown[]): void => {
    this._actionListener.routeAction(event, ...args);
  };

  private _handleKeyDown = (e: KeyboardEvent): void => {
    if (this._filterInputActive) {
      return;
    }
    const action = this._keyRouter.getActionForKey(e) as unknown as Action | undefined;
    if (action) {
      e.preventDefault();
      this._emitAction(action, e);
    }
  };

  private _filterInputBlurred = (): void => {
    this._filterInputActive = false;
  };

  private _filterInputFocused = (): void => {
    this._filterInputActive = true;
  };

  private _emitAction(action: Action | ActionId, e?: Event): void {
    const actionObj: Action = typeof action === 'string' ? { action } : action;
    const event = new ActionEvent(actionObj, (e ?? dummyEvent) as Event);
    this._eventBus.dispatch(event);
  }

  private _setThumbnailZoom = (zoom: number): void => {
    this.setState((prevState) => ({
      winState: { ...prevState.winState, thumbnailZoom: zoom },
    }), () => {
      this._saveLayout();
    });
  };

  private _handleRotate = (): void => {
    this.setState((prevState) => ({
      winState: { ...prevState.winState, rotateMode: (prevState.winState.rotateMode + 1) % rotateModes.length },
    }), () => {
      this._saveLayout();
    });
  };

  private _handleRefreshFolder = (_event: ForwardableEvent, folderName: string): void => {
    this._thumberStream?.send('refreshFolder', folderName);
  };

  private _handleShowFileInfo = (_event: ForwardableEvent, fileInfo: DBFileInfo): void => {
    this._fileInfoMediaManager.requestMedia(fileInfo, (err, mediaInfo) => {
      if (err || !mediaInfo) {
        this.setState({ fileInfo: `Error loading generation data: ${err}` });
        return;
      }
      const { url, type } = mediaInfo;
      (async () => {
        try {
          const metaData = await getGenerationData(url, type, fileInfo.filename);
          this.setState({ fileInfo: { metaData, filename: fileInfo.filename } });
        } catch (error) {
          this.setState({ fileInfo: `Error loading generation data: ${error}` });
        }
      })();
    });
  };

  private _handleCopyFile = (_event: ForwardableEvent, fileInfo: DBFileInfo): void => {
    const type = 'text/plain';
    const clipboardItem = new ClipboardItem({ [type]: fileInfo.filename });
    navigator.clipboard.write([clipboardItem]).catch((error) => {
      console.error('Error copying file to clipboard:', error);
    });
  };

  private _handleCopyFolder = (_event: ForwardableEvent, folderInfo: { filename: string }): void => {
    const type = 'text/plain';
    const clipboardItem = new ClipboardItem({ [type]: folderInfo.filename });
    navigator.clipboard.write([clipboardItem]).catch((error) => {
      console.error('Error copying file to clipboard:', error);
    });
  };

  private _handleDeleteFolder = (_event: ForwardableEvent, folderInfo: { filename: string; archive?: boolean }): void => {
    this.setState((prevState) => ({
      contextFolderInfo: folderInfo,
      showDeleteFolderPrompt: !!(prevState.prefs.misc?.promptOnDeleteFolder),
    }));
    if (!this.state.prefs.misc?.promptOnDeleteFolder) {
      this._deleteFolder();
    }
  };

  private _handleDeleteFile = (_event: ForwardableEvent, fileInfo: DBFileInfo): void => {
    this._pendingDeleteFileInfo = fileInfo;
    this.setState((prevState) => ({
      contextFileInfo: fileInfo,
      showDeleteFilePrompt: !!(prevState.prefs.misc?.promptOnDeleteFile),
    }));
    if (!this.state.prefs.misc?.promptOnDeleteFile) {
      this._deleteFile();
    }
  };

  private _deleteFolder = async (): Promise<void> => {
    this.setState({ showDeleteFolderPrompt: false });
    const filename = this.state.contextFolderInfo?.filename;
    if (!filename) return;
    try {
      await ipcRenderer.invoke('trashItem', filename);
    } catch {
      this.setState((prevState) => ({
        showForceDelete: true,
        forceDeleteFilename: filename,
        forceDeleteIsFolder: !prevState.contextFolderInfo?.archive,
      }));
    }
  };

  private _closeViewerIfShowingFile(filename: string): void {
    if (!this._currentView) return;
    for (const vpair of this._currentView.getAllVPairs()) {
      const vs = vpair.getViewerState();
      if (vs.viewing && vs.filename === filename) {
        const bus = vpair.getEventBus();
        bus.dispatch(new ForwardableEvent('releaseMedia'));
        bus.dispatch(new ForwardableEvent('hide'));
      }
    }
  }

  private _deleteFile = (): void => {
    this.setState({ showDeleteFilePrompt: false });
    const fileInfo = this._pendingDeleteFileInfo || this.state.contextFileInfo;
    const filename = fileInfo?.filename;
    if (!filename) return;
    if (trashingFiles.has(filename)) return;
    addTrashingFile(filename);
    this._closeViewerIfShowingFile(filename);
    if (!this._thumberStream) {
      removeTrashingFile(filename);
      return;
    }
    this._thumberStream.send('trashFile', filename);
  };

  private _handleTrashFailed = (filename: string): void => {
    removeTrashingFile(filename);
    this.setState({
      showForceDelete: true,
      forceDeleteFilename: filename,
      forceDeleteIsFolder: false,
    });
  };

  private _forceDelete = async (): Promise<void> => {
    this.setState({ showForceDelete: false });
    const filename = this.state.forceDeleteFilename ?? '';
    if (this.state.forceDeleteIsFolder) {
      try {
        await rimraf(filename);
      } catch (e) {
        this._logger(e);
      }
    } else {
      ipcRenderer.invoke('deleteFile', filename).catch((err: unknown) => {
        this._logger(err);
      });
    }
  };

  private _handleFileContextMenu = (forwardableEvent: ForwardableEvent, fileInfo: DBFileInfo): void => {
    const event = forwardableEvent.domEvent as MouseEvent & { touches?: TouchList };
    event.preventDefault();
    event.stopPropagation();

    const x = event.clientX || (event.touches?.[0]?.pageX ?? 0);
    const y = event.clientY || (event.touches?.[0]?.pageY ?? 0);

    this.setState({ contextFileInfo: fileInfo });
    hideMenu();
    showMenu({
      position: { x, y },
      rotateMode: this.state.winState.rotateMode,
      id: 'fileContextMenu',
    });
  };

  private _handleFolderContextMenu = (forwardableEvent: ForwardableEvent, folderInfo: { filename: string; archive?: boolean }): void => {
    const event = forwardableEvent.domEvent as MouseEvent & { touches?: TouchList };
    event.preventDefault();
    event.stopPropagation();

    const x = event.clientX || (event.touches?.[0]?.pageX ?? 0);
    const y = event.clientY || (event.touches?.[0]?.pageY ?? 0);

    this.setState({ contextFolderInfo: folderInfo });
    hideMenu();
    showMenu({
      position: { x, y },
      rotateMode: this.state.winState.rotateMode,
      id: 'folderContextMenu',
    });
  };

  private _updatePrefs = (prefs: Preferences): void => {
    this.setState({
      prefsReceived: true,
      prefs,
    }, () => {
      this._keyRouter.registerKeys(prefs.keyConfig as never);
      this._logger('prefs:', JSON.stringify(prefs));
      this._rerunFilter();
    });
  };

  private _showPrefs = (): void => {
    ipcRenderer.send('openWindow', 'prefs');
  };

  private _getToolbar(): React.ReactNode {
    if (!(this.state.winState.showUI & 1)) {  
      return undefined;
    }
    if (this._viewerStateHolder.state?.viewing) {
      const view = this._currentView;
      const anyPlaying = view ? view.anyPlaying() : false;
      return (
        <ViewerToolbar
          actions={this._actionFuncs}
          outEventBus={this._eventBus}
          viewerStateHolder={this._viewerStateHolder}
          anyPlaying={anyPlaying}
        />
      );
    }
    return (
      <ImagegridsToolbar
        actions={this._actionFuncs}
        zoom={this.state.winState.thumbnailZoom}
        sortMode={this.state.winState.sortMode}
        gridMode={this.state.winState.gridMode}
        imagegridStateHolder={this._imagegridStateHolder}
        setThumbnailZoom={this._setThumbnailZoom}
        outEventBus={this._eventBus}
        filter={this.state.filter}
        handleUpdateFilter={this._handleUpdateFilter}
        filterInputBlurred={this._filterInputBlurred}
        filterInputFocused={this._filterInputFocused}
      />
    );
  }

  private _getToolbarError(): React.ReactNode {
    return this.state.filterError
      ? <div className="toolbar-error"><div>{this.state.filterError}</div></div>
      : undefined;
  }

  private _handleSplitResize = (flex: number): void => {
    this.setState((prevState) => ({
      winState: { ...prevState.winState, splitPosition: flex },
    }), () => {
      this._saveLayout();
    });
  };

  private _getForceDeleteMsg(): string {
    const filename = this.state.forceDeleteFilename ?? '';
    if (this.state.forceDeleteIsFolder) {
      const children = this._folderDB.getAllChildren(filename);
      return `Could not move ${filename} to Trash. Really Delete ${filename} and ${children.length}+ file(s) and subfolder(s) inside including ${children.join(', ')}`;
    }
    return `Could not move ${filename} to Trash. Really Delete ${filename}`;
  }

  render(): React.ReactNode {
    this._logger('render');
    const splitStyle: React.CSSProperties = {
      display: 'flex',
      position: 'relative',
      flexDirection: 'column',
    };
    const isFullScreen = true;
    const rotateMode = this.state.winState.rotateMode;
    const showUI = this.state.winState.showUI;
    const hideClass = (showUI & 2) ? 'noop' : 'hide';   
    const fullClass = (showUI & 2) ? 'noop' : 'fullsplit';   
    if (!this.state.prefsReceived) {
      return (<Loading />);
    }
    if (!this.state.totalFiles) {
      return (<WaitForFiles onClick={this._showPrefs} />);
    }
    const toolbarPosition = this.state.prefs.misc!.toolbarPosition;
    const toolbarOnBottom = isFullScreen
      ? s_rotateModeVsToolbarModeBottomTable[rotateMode][toolbarPosition]
      : s_toolbarModeBottomTable[toolbarPosition];
    return (
      <div
        style={splitStyle}
        className={`view ${rotateModes[rotateMode].className}`}
        ref={(ref) => { this._container = ref; }}
      >
        <ToolbarHolder bottom={toolbarOnBottom}>
          {this._getToolbar()}
        </ToolbarHolder>
        {this._getToolbarError()}
        <div style={{ position: 'relative', flex: '1 1 0%', overflow: 'hidden' }}>
          <SplitPane
            rotateMode={rotateMode}
            initialSplit={this.state.winState.splitStartPosition}
            minSize={0}
            firstClassName={hideClass}
            splitterClassName={hideClass}
            secondClassName={fullClass}
            onSplitChange={this._handleSplitResize}
            first={
              <Folders
                root={this.state.root}
                eventBus={this._eventBus}
                prefs={this.state.prefs as Preferences}
                show={!!(this.state.winState.showUI & 2)}  
                rotateMode={rotateMode}
              />
            }
            second={
              <ViewSplitHolder
                root={this.state.root}
                options={this.props.options}
                prefs={this.state.prefs as Preferences}
                rotateMode={rotateMode}
                startingLayout={this.props.startState?.layout as never}
                setCurrentView={this._setCurrentView}
                winState={this.state.winState}
                toolbarEventBus={this._toolbarEventBus}
              />
            }
          />

          <FolderContextMenu
            rotateMode={rotateMode}
            folder={this.state.contextFolderInfo!}
            eventBus={this._eventBus}
          />
          <FileContextMenu
            rotateMode={rotateMode}
            file={this.state.contextFileInfo!}
            eventBus={this._eventBus}
          />
          {this.state.showDeleteFilePrompt && this.state.contextFileInfo && (
            <OkayCancel
              parent={this._container ?? undefined}
              okay="Trash File"
              msg={`Trash ${this.state.contextFileInfo.filename}?`}
              onOkay={this._deleteFile}
              onCancel={() => { this.setState({ showDeleteFilePrompt: false }); }}
            />
          )}
          {this.state.showDeleteFolderPrompt && this.state.contextFolderInfo && (
            <OkayCancel
              parent={this._container ?? undefined}
              okay={this.state.contextFolderInfo.archive ? 'Trash Archive' : 'Trash Folder'}
              msg={`Trash ${this.state.contextFolderInfo.filename}?`}
              onOkay={this._deleteFolder}
              onCancel={() => { this.setState({ showDeleteFolderPrompt: false }); }}
            />
          )}
          {this.state.showForceDelete && (
            <OkayCancel
              parent={this._container ?? undefined}
              okay={this.state.forceDeleteIsFolder ? 'Really Delete Folder' : 'Really Delete File'}
              msg={this._getForceDeleteMsg()}
              onOkay={this._forceDelete}
              onCancel={() => { this.setState({ showForceDelete: false }); }}
            />
          )}
          {this.state.fileInfo && (
            <FileInfo
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              fileInfo={this.state.fileInfo as any}
              onClose={() => { this.setState({ fileInfo: null }); }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              parent={this._container as any}
              close="close"
            />
          )}
        </div>
      </div>
    );
  }
}
