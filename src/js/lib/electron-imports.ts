// Central re-exports for electron (CJS package).
// ESM cannot use named imports from CJS modules, so we destructure
// from the default export here and re-export for the rest of the app.

import electron from 'electron';

export const app = electron.app;
export const ipcMain = electron.ipcMain;
export const ipcRenderer = electron.ipcRenderer;
export const nativeImage = electron.nativeImage;
export const shell = electron.shell;

// Classes need value + type exports so they work as both constructors and type annotations.
export const BrowserWindow = electron.BrowserWindow;
export type BrowserWindow = InstanceType<typeof electron.BrowserWindow>;
export const Menu = electron.Menu;
export type Menu = InstanceType<typeof electron.Menu>;
export const MenuItem = electron.MenuItem;
export type MenuItem = InstanceType<typeof electron.MenuItem>;

export type { Rectangle, WebContents } from 'electron';

// Re-export the full electron default for cases that need it directly (e.g. electron.screen)
export default electron;
