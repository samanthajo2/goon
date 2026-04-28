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

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Platform } from '../../lib/platform.js';
import { hideMenu, showMenu } from '../../lib/ui/context-menu.js';
import ActionEvent from '../../lib/action-event.js';
import ActionListener from '../../lib/action-listener.js';
import { getGenerationData } from '../../lib/metadata.js';
import SplitPane from '../../lib/ui/split-pane.js';
import FileContextMenu from './file-context-menu.js';
import FolderContextMenu from './folder-context-menu.js';
import FileInfo from './file-info.js';
import OkayCancel from '../../lib/ui/okay-cancel.js';
import Folders from './folders.js';
import { sortModes } from './folder-state-helper.js';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher.js';
import type { AppEventMap } from './app-event-map.js';
import ForwardableEvent from '../../lib/forwardable-event.js';
import { trashingFiles, addTrashingFile, removeTrashingFile } from './trashing-state.js';
import { getSelected, clearSelection } from './selection-state.js';
import DeletePrompt, { DeleteItem } from './delete-prompt.js';
import KeyRouter from '../../lib/keyrouter.js';
import debug from '../../lib/debug.js';
import { rotateModes } from '../../lib/rotatehelper.js';
import ImagegridsToolbar from './imagegrids-toolbar.js';
import ViewerToolbar from './viewer-toolbar.js';
import ViewSplitHolder from './view-split-holder.js';
import { makeActionFuncs, ActionId, Action } from '../../lib/actions.js';
import gridModes from './grid-modes.js';
import { makeCompositeFilter } from '../../lib/make-filter.js';
import ToolbarHolder from './toolbar-holder.js';
import WaitForFiles from './wait-for-files.js';
import Loading from './loading.js';
import MediaManagerClient from '../../lib/media-manager-client.js';
import { Preferences } from '../prefs/default-prefs.js';
import { DBFileInfo } from './folder-db.js';
import ViewSplit from './viewsplit.js';
import { ImagegridStateHolder } from './viewer-events.js';
import type { FolderContextInfo } from './viewer-events.js';
import { useWinState } from './hooks/use-win-state.js';
import { useIPCStreams } from './hooks/use-ipc-streams.js';
import { useFilter, makeGoodFilter, makeSmallDimensionsFilter } from './hooks/use-filter.js';
import { useFolderPipeline } from './hooks/use-folder-pipeline.js';
import { AppContext } from './contexts.js';

const dummyEvent = {
  preventDefault: () => {},
  stopPropagation: () => {},
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

type FileInfoData = { filename: string; metaData: unknown } | string | null;

type Props = {
  options: {
    columnWidth: number;
    padding: number;
    maxSeekTime: number;
  };
  platform: Platform;
  startState?: {
    winState?: Parameters<typeof useWinState>[1];
    layout?: unknown;
  };
};

function App({ options, startState, platform }: Props): React.ReactElement | null {
  const logger = useRef(debug('App')).current;

  // ── Window state (sort mode, grid mode, zoom, rotation, split, UI) ──
  const { winState, updateWinState } = useWinState(platform, startState?.winState);

  // ── UI state (declared early so handleTrashFailed can reference the setters) ──
  const [contextFileInfo, setContextFileInfo] = useState<DBFileInfo | null>(null);
  const [contextFolderInfo, setContextFolderInfo] = useState<FolderContextInfo | null>(null);
  const [fileInfo, setFileInfo] = useState<FileInfoData>(null);
  const [showDeleteFilePrompt, setShowDeleteFilePrompt] = useState(false);
  const [pendingDeleteItems, setPendingDeleteItems] = useState<DeleteItem[]>([]);
  const [showDeleteFolderPrompt, setShowDeleteFolderPrompt] = useState(false);
  const [showForceDelete, setShowForceDelete] = useState(false);
  const [forceDeleteFilename, setForceDeleteFilename] = useState('');
  const [forceDeleteIsFolder, setForceDeleteIsFolder] = useState(false);
  // Failed-trash items accumulated to show as a single batched force-delete prompt.
  const [showForceDeleteFiles, setShowForceDeleteFiles] = useState(false);
  const [forceDeleteItems, setForceDeleteItems] = useState<DeleteItem[]>([]);
  const forceDeleteBufferRef = useRef<DeleteItem[]>([]);
  const forceDeleteFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── IPC streams (thumber + prefs) ──────────────────────────────────
  // Buffer trashFailed events for ~250ms so a batch of failures shows
  // up as a single prompt rather than one per failed file.
  const handleTrashFailed = useCallback((filename: string) => {
    removeTrashingFile(filename);
    // Look up FileInfo so we can show a thumbnail.
    let info: DeleteItem['info'] | undefined;
    // rootRef is declared below; the callback closure resolves it at call time.
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    for (const folder of rootRef.current.folders) {
      for (const file of folder.files) {
        if (file.info.filename === filename) {
          info = file.info;
          break;
        }
      }
      if (info) break;
    }
    if (info) {
      forceDeleteBufferRef.current.push({ filename, info });
    }
    if (forceDeleteFlushTimerRef.current) {
      clearTimeout(forceDeleteFlushTimerRef.current);
    }
    forceDeleteFlushTimerRef.current = setTimeout(() => {
      const items = forceDeleteBufferRef.current;
      forceDeleteBufferRef.current = [];
      forceDeleteFlushTimerRef.current = null;
      if (items.length === 0) return;
      setForceDeleteItems(items);
      setShowForceDeleteFiles(true);
    }, 250);
  }, []);

  const { thumberStream, prefs, prefsReceived, disconnected } = useIPCStreams(platform, { onTrashFailed: handleTrashFailed });
  const [externalViewerAvailable, setExternalViewerAvailable] = useState(false);

  // ── Filter state ───────────────────────────────────────────────────
  const {
    filter,
    filterError,
    userFilterFn,
    filterShowBad,
    filterSmallImages,
    handleUpdateFilter,
    filterInputFocused,
    filterInputBlurred,
    isFilterInputActive,
  } = useFilter(prefs);

  const compositeFilter = useMemo(
    () => makeCompositeFilter([makeGoodFilter(filterShowBad), makeSmallDimensionsFilter(filterSmallImages), userFilterFn]),
    [filterShowBad, filterSmallImages, userFilterFn],
  );

  // ── Folder data pipeline ───────────────────────────────────────────
  const showEmpty = !!(prefs.misc?.showEmpty);
  const { root, totalFiles, folderDB } = useFolderPipeline({
    thumberStream,
    compositeFilter,
    sortMode: winState.sortMode,
    showEmpty,
  });

  // ── Stable refs ────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement | null>(null);
  const currentViewRef = useRef<ViewSplit | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const rootRef = useRef(root);
  rootRef.current = root;

  const fileInfoMediaManager = useRef(new MediaManagerClient(platform)).current;

  // Plain (non-reactive) holder for the active pane's imagegrid state.
  // ImagegridState has no fields so this is purely for API compatibility with ImagegridsToolbar.
  const imagegridStateHolder = useRef<ImagegridStateHolder>({ state: null }).current;

  // Whether the active pane is currently showing the viewer (vs the image grid).
  // Drives ViewerToolbar ↔ ImagegridsToolbar switching.
  const [isViewing, setIsViewing] = useState(false);

  // ── Event buses (stable refs) ──────────────────────────────────────
  const eventBus = useRef(new ForwardableEventDispatcher<AppEventMap>()).current;
  const toolbarEventBus = useRef(new ForwardableEventDispatcher<AppEventMap>()).current;
  const imageGridToolbarEventBus = useRef(new ForwardableEventDispatcher<AppEventMap>()).current;
  const viewerToolbarEventBus = useRef(new ForwardableEventDispatcher<AppEventMap>()).current;

  // ── Key router & action listener (stable refs) ─────────────────────
  const keyRouter = useRef(new KeyRouter()).current;
  const actionListener = useRef(new ActionListener()).current;

  // ── Action functions ───────────────────────────────────────────────
  const emitAction = useCallback((act: Action | ActionId, e?: Event) => {
    const actionObj: Action = typeof act === 'string' ? { action: act } : act;
    const event = new ActionEvent(actionObj, (e ?? dummyEvent) as Event);
    eventBus.dispatch(event);
  }, [eventBus]);

  const actionFuncs = useMemo(
    () => makeActionFuncs((act: Action) => emitAction(act)),
    [emitAction],
  );

  // ── setCurrentView ─────────────────────────────────────────────────
  const setCurrentView = useCallback((view: ViewSplit | null) => {
    currentViewRef.current = view;
    eventBus.setForward(view ? view.getEventBus() : null);
    imagegridStateHolder.state = view ? view.getImagegridState() : null;
    // isViewing is kept in sync by onViewingChanged (called by VPair/ViewSplit);
    // here we only sync when the active pane itself changes.
    setIsViewing(!!(view?.getViewerState()?.viewing));
  }, [eventBus, imagegridStateHolder]);

  // ── Delete helpers ─────────────────────────────────────────────────
  const closeViewerIfShowingFile = useCallback((filename: string) => {
    const view = currentViewRef.current;
    if (!view) return;
    for (const vpair of view.getAllVPairs()) {
      const vs = vpair.getViewerState();
      if (vs.viewing && vs.filename === filename) {
        const bus = vpair.getEventBus();
        bus.dispatch(new ForwardableEvent('releaseMedia'));
        bus.dispatch(new ForwardableEvent('hide'));
      }
    }
  }, []);

  const deleteOneFile = useCallback((filename: string) => {
    if (trashingFiles.has(filename)) return;
    addTrashingFile(filename);
    closeViewerIfShowingFile(filename);
    if (!thumberStream) {
      removeTrashingFile(filename);
      return;
    }
    // Give the browser a frame to release the file handle after clearing img/video src
    setTimeout(() => {
      thumberStream.send('trashFile', filename);
    }, 100);
  }, [thumberStream, closeViewerIfShowingFile]);

  const deleteFile = useCallback(() => {
    setShowDeleteFilePrompt(false);
    const items = pendingDeleteItems;
    setPendingDeleteItems([]);
    // Skip archive entries — they're not real files on disk and can't be trashed.
    const realItems = items.filter(it => !it.info.archiveName);
    for (const item of realItems) {
      deleteOneFile(item.filename);
    }
    // Clear the multi-select once the action is confirmed
    if (items.length > 1) {
      clearSelection();
    }
  }, [pendingDeleteItems, deleteOneFile]);

  const deleteFolder = useCallback(async () => {
    setShowDeleteFolderPrompt(false);
    const filename = contextFolderInfo?.filename;
    if (!filename || !platform.trashItem) return;
    try {
      await platform.trashItem(filename);
    } catch {
      setShowForceDelete(true);
      setForceDeleteFilename(filename);
      setForceDeleteIsFolder(!contextFolderInfo?.archive);
    }
  }, [contextFolderInfo, platform]);

  const forceDelete = useCallback(async () => {
    setShowForceDelete(false);
    if (!forceDeleteFilename) return;
    if (forceDeleteIsFolder) {
      if (!platform.deleteFolder) return;
      try {
        await platform.deleteFolder(forceDeleteFilename);
      } catch (e) {
        logger(e);
      }
    } else if (platform.deleteFile) {
      try {
        await platform.deleteFile(forceDeleteFilename);
        thumberStream?.send('removeFile', forceDeleteFilename);
      } catch (err) {
        logger(err);
      }
    }
  }, [forceDeleteFilename, forceDeleteIsFolder, thumberStream, logger, platform]);

  const forceDeleteFiles = useCallback(async () => {
    setShowForceDeleteFiles(false);
    const items = forceDeleteItems;
    setForceDeleteItems([]);
    if (!platform.deleteFile) return;
    for (const item of items) {
      try {
        await platform.deleteFile(item.filename);
        thumberStream?.send('removeFile', item.filename);
      } catch (err) {
        logger(err);
      }
    }
  }, [forceDeleteItems, thumberStream, logger, platform]);

  // ── Stable refs for callbacks that reference mutable state ────────
  // (declared before the one-time useEffect so lint can see they're defined)
  const winStateRef = useRef(winState);
  winStateRef.current = winState;
  const thumberStreamRef = useRef(thumberStream);
  thumberStreamRef.current = thumberStream;
  const deleteFileRef = useRef(deleteFile);
  deleteFileRef.current = deleteFile;
  const deleteFolderRef = useRef(deleteFolder);
  deleteFolderRef.current = deleteFolder;

  // ── One-time setup: event bus listeners, key handler, prefs, etc. ──
  useEffect(() => {
    eventBus.debugId = logger.getPrefix();

    // action event → route through ActionListener
    const handleActions = (event: ForwardableEvent, ...args: unknown[]) => {
      // routeAction expects ActionEvent, but the event bus types the handler as
      // ForwardableEvent. The runtime value is always ActionEvent here because
      // 'action' events are only dispatched via ActionEvent. Cast is safe.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      actionListener.routeAction(event as any, ...args);
    };
    eventBus.on('action', handleActions);

    const handleFileContextMenu = (forwardableEvent: ForwardableEvent, fileInfoArg: DBFileInfo) => {
      const event = forwardableEvent.domEvent as MouseEvent & { touches?: TouchList };
      event.preventDefault();
      event.stopPropagation();
      const x = event.clientX || (event.touches?.[0]?.pageX ?? 0);
      const y = event.clientY || (event.touches?.[0]?.pageY ?? 0);
      setContextFileInfo(fileInfoArg);
      hideMenu();
      showMenu({ position: { x, y }, rotateMode: winStateRef.current.rotateMode, id: 'fileContextMenu' });
    };
    eventBus.on('fileContextMenu', handleFileContextMenu);

    const handleFolderContextMenu = (forwardableEvent: ForwardableEvent, folderInfo: FolderContextInfo) => {
      const event = forwardableEvent.domEvent as MouseEvent & { touches?: TouchList };
      event.preventDefault();
      event.stopPropagation();
      const x = event.clientX || (event.touches?.[0]?.pageX ?? 0);
      const y = event.clientY || (event.touches?.[0]?.pageY ?? 0);
      setContextFolderInfo(folderInfo);
      hideMenu();
      showMenu({ position: { x, y }, rotateMode: winStateRef.current.rotateMode, id: 'folderContextMenu' });
    };
    eventBus.on('folderContextMenu', handleFolderContextMenu);

    const handleRefreshFolder = (_event: ForwardableEvent, folderName: string) => {
      thumberStreamRef.current?.send('refreshFolder', folderName);
    };
    eventBus.on('refreshFolder', handleRefreshFolder);

    const handleRefreshFolders = () => {
      thumberStreamRef.current?.send('refreshFolders');
    };
    eventBus.on('refreshFolders', handleRefreshFolders);

    const handleDeleteFile = (_event: ForwardableEvent, fileInfoArg: DBFileInfo) => {
      setContextFileInfo(fileInfoArg);
      // If the triggered file is part of a multi-selection, delete the whole selection.
      // Otherwise just delete the one file.
      const sel = getSelected();
      let filenames: string[];
      if (sel.has(fileInfoArg.filename) && sel.size > 1) {
        filenames = Array.from(sel);
      } else {
        filenames = [fileInfoArg.filename];
      }
      // Build DeleteItem[] by looking up FileInfo from root.
      const fileInfoByName = new Map<string, DeleteItem['info']>();
      for (const folder of rootRef.current.folders) {
        for (const file of folder.files) {
          fileInfoByName.set(file.info.filename, file.info);
        }
      }
      const items: DeleteItem[] = [];
      for (const fn of filenames) {
        const info = fileInfoByName.get(fn);
        if (info) items.push({ filename: fn, info });
      }
      // Always show the modal now (with thumbnails) so the user can verify.
      // The prompt-on-delete pref is honored — if disabled and only one item, skip.
      setPendingDeleteItems(items);
      if (items.length === 0) return;
      if (items.length === 1 && !prefsRef.current.misc?.promptOnDeleteFile) {
        // Single file with prompt disabled — go straight to delete
        deleteOneFile(items[0].filename);
        setPendingDeleteItems([]);
      } else {
        setShowDeleteFilePrompt(true);
      }
    };
    eventBus.on('deleteFile', handleDeleteFile);

    const handleDeleteFolder = (_event: ForwardableEvent, folderInfo: FolderContextInfo) => {
      setContextFolderInfo(folderInfo);
      if (prefsRef.current.misc?.promptOnDeleteFolder) {
        setShowDeleteFolderPrompt(true);
      } else {
        deleteFolderRef.current();
      }
    };
    eventBus.on('deleteFolder', handleDeleteFolder);

    const handleCopyFile = (_event: ForwardableEvent, fileInfoArg: DBFileInfo) => {
      const clipboardItem = new ClipboardItem({ 'text/plain': fileInfoArg.filename });
      navigator.clipboard.write([clipboardItem]).catch((error) => {
        console.error('Error copying file to clipboard:', error);
      });
    };
    eventBus.on('copyFile', handleCopyFile);

    const handleCopyFolder = (_event: ForwardableEvent, folderInfo: FolderContextInfo) => {
      const clipboardItem = new ClipboardItem({ 'text/plain': folderInfo.filename });
      navigator.clipboard.write([clipboardItem]).catch((error) => {
        console.error('Error copying file to clipboard:', error);
      });
    };
    eventBus.on('copyFolder', handleCopyFolder);

    const handleShowFileInfo = (_event: ForwardableEvent, fileInfoArg: DBFileInfo) => {
      fileInfoMediaManager.requestMedia(fileInfoArg, (err, mediaInfo) => {
        if (err || !mediaInfo) {
          setFileInfo(`Error loading generation data: ${err}`);
          return;
        }
        const { url, type } = mediaInfo;
        (async () => {
          try {
            const metaData = await getGenerationData(url, type, fileInfoArg.filename);
            setFileInfo({ metaData, filename: fileInfoArg.filename });
          } catch (error) {
            setFileInfo(`Error loading generation data: ${error}`);
          }
        })();
      });
    };
    eventBus.on('showFileInfo', handleShowFileInfo);

    // ActionListener actions
    actionListener.on('toggleUI', () => {
      updateWinState((prev) => ({ showUI: (prev.showUI + 3) % 4 }));
    });
    actionListener.on('rotate', () => {
      updateWinState((prev) => ({ rotateMode: (prev.rotateMode + 1) % rotateModes.length }));
    });
    actionListener.on('cycleSortMode', () => {
      updateWinState((prev) => ({ sortMode: sortModes.next(prev.sortMode) }));
    });
    actionListener.on('cycleGridMode', () => {
      updateWinState((prev) => ({ gridMode: gridModes.next(prev.gridMode) }));
    });
    actionListener.on('toggleFullscreen', () => { platform.toggleFullscreen(); });
    actionListener.on('newWindow', () => { platform.openNewWindow('view'); });
    actionListener.on('showHelp', () => { platform.openNewWindow('help'); });
    actionListener.on('refreshFolders', () => { eventBus.dispatch(new ForwardableEvent('refreshFolders')); });
    actionListener.on('trashSelected', () => {
      const sel = getSelected();
      if (sel.size === 0) return;
      // Find the FileInfo of the first selected file and dispatch deleteFile.
      // The deleteFile handler already detects multi-select and uses the whole set.
      const firstFilename = sel.values().next().value as string;
      for (const folder of rootRef.current.folders) {
        for (const file of folder.files) {
          if (file.info.filename === firstFilename) {
            eventBus.dispatch(new ForwardableEvent('deleteFile'), file.info as unknown as DBFileInfo);
            return;
          }
        }
      }
    });

    // Action routing from outside the renderer (Electron menu bar, etc.)
    const unsubscribeOnAction = platform.onAction((actionId) => {
      eventBus.dispatch(new ActionEvent({ action: actionId }));
    });

    // Keyboard
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isFilterInputActive()) return;
      const act = keyRouter.getActionForKey(e) as unknown as Action | undefined;
      if (act) {
        e.preventDefault();
        emitAction(act, e);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Initial toolbar forwarding — updated reactively in the isViewing useEffect below.
    toolbarEventBus.setForward(imageGridToolbarEventBus);

    platform.setupFullscreen();

    return () => {
      actionListener.close();
      unsubscribeOnAction();
      window.removeEventListener('keydown', handleKeyDown);
    };
  // All values used inside (eventBus, actionListener, keyRouter, etc.) are
  // stable refs created once via useRef — they never change between renders,
  // so [] is correct and the exhaustive-deps warning is a false positive.
  // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, []);

  // ── Update key bindings when prefs arrive ──────────────────────────
  useEffect(() => {
    if (prefsReceived) {
      keyRouter.registerKeys(prefs.keyConfig ?? []);
      logger('prefs:', JSON.stringify(prefs));
    }
  }, [prefs, prefsReceived, keyRouter, logger]);

  // ── Check external viewer availability when path pref changes ────────
  useEffect(() => {
    const exePath = prefs.misc?.externalViewerPath ?? '';
    if (!exePath || !platform.checkFileExists) {
      setExternalViewerAvailable(false); // eslint-disable-line @eslint-react/set-state-in-effect
      return;
    }
    platform.checkFileExists(exePath).then((exists: boolean) => {
      setExternalViewerAvailable(exists);
    });
  }, [prefs.misc?.externalViewerPath, platform]);

  // ── Toolbar forwarding — switch between viewer and imagegrid toolbar ──
  useEffect(() => {
    toolbarEventBus.setForward(isViewing ? viewerToolbarEventBus : imageGridToolbarEventBus);
  }, [isViewing, toolbarEventBus, viewerToolbarEventBus, imageGridToolbarEventBus]);

  // ── Callback for VPair/ViewSplit to notify us when viewing state changes ──
  const onViewingChanged = useCallback((viewing: boolean) => {
    setIsViewing(viewing);
  }, []);

  // ── Render helpers ─────────────────────────────────────────────────
  const setThumbnailZoom = useCallback((zoom: number) => {
    updateWinState({ thumbnailZoom: zoom });
  }, [updateWinState]);

  const handleSplitResize = useCallback((flex: number) => {
    updateWinState({ splitPosition: flex });
  }, [updateWinState]);

  const showPrefs = useCallback(() => {
    platform.openNewWindow('prefs');
  }, [platform]);

  const getForceDeleteMsg = (): string => {
    if (forceDeleteIsFolder) {
      const children = folderDB.getAllChildren(forceDeleteFilename);
      return `Could not move ${forceDeleteFilename} to Trash. Really Delete ${forceDeleteFilename} and ${children.length}+ file(s) and subfolder(s) inside including ${children.join(', ')}`;
    }
    return `Could not move ${forceDeleteFilename} to Trash. Really Delete ${forceDeleteFilename}`;
  };

  const getToolbar = (): React.ReactNode => {
    if (!(winState.showUI & 1)) {
      return undefined;
    }
    if (isViewing) {
      const view = currentViewRef.current;
      const anyPlaying = view ? view.anyPlaying() : false;
      return (
        <ViewerToolbar
          actions={actionFuncs}
          outEventBus={eventBus}
          inEventBus={viewerToolbarEventBus}
          anyPlaying={anyPlaying}
          externalViewerAvailable={externalViewerAvailable}
        />
      );
    }
    return (
      <ImagegridsToolbar
        actions={actionFuncs}
        zoom={winState.thumbnailZoom}
        sortMode={winState.sortMode}
        gridMode={winState.gridMode}
        imagegridStateHolder={imagegridStateHolder}
        setThumbnailZoom={setThumbnailZoom}
        outEventBus={eventBus}
        filter={filter}
        handleUpdateFilter={handleUpdateFilter}
        filterInputBlurred={filterInputBlurred}
        filterInputFocused={filterInputFocused}
      />
    );
  };

  // ── Early exits ────────────────────────────────────────────────────
  logger('render');

  if (!prefsReceived) {
    return (<Loading />);
  }
  if (!totalFiles) {
    return (<WaitForFiles onClick={platform.kind === 'electron' ? showPrefs : undefined} />);
  }

  // ── Main render ────────────────────────────────────────────────────
  const splitStyle: React.CSSProperties = {
    display: 'flex',
    position: 'relative',
    flexDirection: 'column',
  };
  const isFullScreen = true;
  const rotateMode = winState.rotateMode;
  const showUI = winState.showUI;
  const hideClass = (showUI & 2) ? 'noop' : 'hide';
  const fullClass = (showUI & 2) ? 'noop' : 'fullsplit';
  const toolbarPosition = prefs.misc!.toolbarPosition;
  const toolbarOnBottom = isFullScreen
    ? s_rotateModeVsToolbarModeBottomTable[rotateMode][toolbarPosition]
    : s_toolbarModeBottomTable[toolbarPosition];

  return (
    <AppContext value={{ eventBus, prefs: prefs as Preferences, platform }}>
    <div
      style={splitStyle}
      className={`view ${rotateModes[rotateMode].className}`}
      ref={(ref) => { containerRef.current = ref; }}
    >
      {disconnected && (
        <div className="disconnected-overlay">
          <div>Disconnected — reconnecting…</div>
        </div>
      )}
      <ToolbarHolder bottom={toolbarOnBottom}>
        {getToolbar()}
      </ToolbarHolder>
      {filterError && (
        <div className="toolbar-error"><div>{filterError}</div></div>
      )}
      <div style={{ position: 'relative', flex: '1 1 0%', overflow: 'hidden' }}>
        <SplitPane
          rotateMode={rotateMode}
          initialSplit={winState.splitStartPosition}
          minSize={0}
          firstClassName={hideClass}
          splitterClassName={hideClass}
          secondClassName={fullClass}
          onSplitChange={handleSplitResize}
          first={
            <Folders
              root={root}
              show={!!(winState.showUI & 2)}
              rotateMode={rotateMode}
            />
          }
          second={
            <ViewSplitHolder
              root={root}
              options={options}
              rotateMode={rotateMode}
              gaplessDividers={prefs.misc?.gaplessDividers}
              startingLayout={startState?.layout as never}
              setCurrentView={setCurrentView}
              winState={winState}
              toolbarEventBus={toolbarEventBus}
              onViewingChanged={onViewingChanged}
            />
          }
        />

        <FolderContextMenu
          rotateMode={rotateMode}
          folder={contextFolderInfo!}
        />
        <FileContextMenu
          rotateMode={rotateMode}
          file={contextFileInfo!}
        />
        {showDeleteFilePrompt && pendingDeleteItems.length > 0 && (
          <DeletePrompt
            parent={containerRef.current ?? undefined}
            okay="Trash"
            items={pendingDeleteItems}
            onOkay={deleteFile}
            onCancel={() => {
              setShowDeleteFilePrompt(false);
              setPendingDeleteItems([]);
            }}
          />
        )}
        {showDeleteFolderPrompt && contextFolderInfo && (
          <OkayCancel
            parent={containerRef.current ?? undefined}
            okay={contextFolderInfo.archive ? 'Trash Archive' : 'Trash Folder'}
            msg={`Trash ${contextFolderInfo.filename}?`}
            onOkay={deleteFolder}
            onCancel={() => { setShowDeleteFolderPrompt(false); }}
          />
        )}
        {showForceDelete && (
          <OkayCancel
            parent={containerRef.current ?? undefined}
            okay={forceDeleteIsFolder ? 'Really Delete Folder' : 'Really Delete File'}
            msg={getForceDeleteMsg()}
            onOkay={forceDelete}
            onCancel={() => { setShowForceDelete(false); }}
          />
        )}
        {showForceDeleteFiles && forceDeleteItems.length > 0 && (
          <DeletePrompt
            parent={containerRef.current ?? undefined}
            okay="Permanently Delete"
            items={forceDeleteItems}
            headline={`Couldn't trash ${forceDeleteItems.length} file${forceDeleteItems.length === 1 ? '' : 's'}. Delete permanently?`}
            onOkay={forceDeleteFiles}
            onCancel={() => {
              setShowForceDeleteFiles(false);
              setForceDeleteItems([]);
            }}
          />
        )}
        {fileInfo && (
          <FileInfo
            // FileInfo props are typed loosely in the legacy component; narrowing
            // them here would require refactoring FileInfo itself (out of scope).
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            fileInfo={fileInfo as any}
            onClose={() => { setFileInfo(null); }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            parent={containerRef.current as any}
            close="close"
          />
        )}
      </div>
    </div>
    </AppContext>
  );
}

export default App;
