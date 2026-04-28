/*
  Electron-backed Platform implementation. Wires every capability to the
  existing ipcRenderer channels / fullscreen helpers.
*/

import { ipcRenderer } from './electron-imports.js';
import { otherWindowIPC } from './electron-renderer-imports.js';
import { setupFullscreen, toggleFullscreen } from './fullscreen.js';
import type { ActionId } from './actions.js';
import type { Platform, WindowKind } from './platform.js';

export function createElectronPlatform(): Platform {
  return {
    createChannelStream(channelId: string) {
      return otherWindowIPC.createChannelStream(channelId);
    },
    toggleFullscreen,
    setupFullscreen,
    openNewWindow(kind: WindowKind) {
      ipcRenderer.send('openWindow', kind);
    },
    saveWinState(state: unknown) {
      ipcRenderer.send('saveWinState', state);
    },
    saveSplitLayout(layout: unknown) {
      ipcRenderer.send('saveSplitLayout', layout);
    },
    onAction(handler: (actionId: ActionId) => void) {
      const wrapper = (_e: unknown, actionId: ActionId): void => handler(actionId);
      ipcRenderer.on('action', wrapper);
      return () => { ipcRenderer.removeListener('action', wrapper); };
    },
    trashItem(filename: string) {
      return ipcRenderer.invoke('trashItem', filename) as Promise<void>;
    },
    deleteFile(filename: string) {
      return ipcRenderer.invoke('deleteFile', filename) as Promise<void>;
    },
    showItemInFolder(filename: string) {
      ipcRenderer.send('showItemInFolder', filename);
    },
    openPath(filename: string) {
      ipcRenderer.send('openPath', filename);
    },
    startDrag(files: string | string[]) {
      ipcRenderer.send('dragStart', files);
    },
    launchBrowser(filename: string) {
      ipcRenderer.invoke('launchBrowser', filename);
    },
    launchExternalViewer(viewerPath: string, filename: string) {
      ipcRenderer.invoke('launchExternalViewer', viewerPath, filename);
    },
    checkFileExists(filename: string) {
      return ipcRenderer.invoke('checkFileExists', filename) as Promise<boolean>;
    },
  };
}
