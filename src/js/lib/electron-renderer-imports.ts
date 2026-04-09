// Re-exports for renderer-only CJS packages (@electron/remote, other-window-ipc).
// These MUST NOT be imported from the main process.

import electronRemote from '@electron/remote';

export const getCurrentWindow = electronRemote.getCurrentWindow;
export const Menu = electronRemote.Menu;
export const MenuItem = electronRemote.MenuItem;
export const dialog = electronRemote.dialog;
export const electronRequire = electronRemote.require;

export * as otherWindowIPC from './window-ipc.js';
export type { ChannelStream } from './window-ipc.js';
