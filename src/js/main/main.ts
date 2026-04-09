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

import path from 'node:path';
import fs from 'node:fs';
import { Server } from 'http'
import { Command } from 'commander';
import debugFn from 'debug';
import express from 'express';
import electron, { BrowserWindow, nativeImage, type WebContents } from '../lib/electron-imports.js';
import { initRelay } from '../lib/window-ipc.js';

import {getUpdateCheckDate} from '../lib/update-manager.js';
import appdata from '../lib/appdata.js';
import * as utils from '../lib/utils.js';
import { getFreePort } from '../lib/get-free-port.js';
import {loadPrefs, Preferences} from '../pages/prefs/default-prefs.js';
import {
  isTitlebarOnAtLeastOneDisplay,
  putWindowOnNearestDisplay,
} from '../lib/window-restore-helper.js';
import listCacheFiles from './list-cache-files.js';
import compareFoldersToCache from './compare-folders-to-cache.js';
import { Rect } from '../lib/rect.js';
import { WinState } from '../lib/win-state.js';
import { ProgOptions } from './program-options.js';

import {windowTrackerInit, windowTrackerIsAnyWindowFullScreen} from '../lib/remote-helpers.cjs';


initRelay();

// IPC handlers for renderer window operations (replaces @electron/remote getCurrentWindow)
electron.ipcMain.handle('window:isFullScreen', (e) =>
  BrowserWindow.fromWebContents(e.sender)?.isFullScreen() ?? false
);
electron.ipcMain.on('window:setFullScreen', (e, flag: boolean) => {
  BrowserWindow.fromWebContents(e.sender)?.setFullScreen(flag);
});
electron.ipcMain.on('window:setMenu', (e, menu: null) => {
  BrowserWindow.fromWebContents(e.sender)?.setMenu(menu);
});
electron.ipcMain.on('window:hide', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.hide();
});
electron.ipcMain.on('window:showInactive', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.showInactive();
});
electron.ipcMain.on('window:inspectElement', (e, x: number, y: number) => {
  e.sender.inspectElement(x, y);
});
electron.ipcMain.handle('window:showOpenDialog', async (e, options) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  return electron.dialog.showOpenDialog(win!, options);
});
electron.ipcMain.on('window:isAnyFullScreen', (e) => {
  e.returnValue = windowTrackerIsAnyWindowFullScreen();
});

const debug = debugFn('main');
const isDevMode = process.env.NODE_ENV === 'development';
const isOSX = process.platform === 'darwin';

const program = new Command();

program
  .option('-h, --help', 'displays help')
  .option('--user-data-dir <path>', 'place to store app data for user', path.join(appdata.localAppDataDir, 'Goon'))
  .option('--inspector <type>', 'which windows to inspect', 'none')
  .option('--list-cache-files', 'list the cache files')
  .option('--compare-folders-to-cache', 'compare folders on disk to cache contents')
  .option('--delete-folder-data-if-no-files-for-archive', 'delete folder data if no files for archive')
  .option('--max-parallel-readdirs <number>', 'maximum parallel readdirs', '2')
  .option('--readdirs-throttle-duration <number>', 'amount to throttle readdir calls in milliseconds', '0')
  .argument('[folders...]', 'folders');

program.parse(process.argv);

const args = program.opts() as unknown as ProgOptions;

if (args.help) {
  program.outputHelp();
  process.exit(0);
}

function removeTrailingSlash(s: string): string {
  return (s.endsWith('/') || s.endsWith('\\')) ? s.substring(0, s.length - 1) : s;
}

function normalizePaths(paths: string[]): string[] {
  const newPaths: string[] = [];
  paths.forEach((dir) => {
    const tempPath = path.normalize(path.resolve(process.cwd(), removeTrailingSlash(dir)));
    try {
      newPaths.push(utils.getActualFilename(tempPath));
    } catch (e) {
      console.error(e?.toString().split('\n')[0]);
    }
  });
  return newPaths;
}

args._ = normalizePaths(program.args);
args.userDataDir = path.resolve(args.userDataDir);
if (!fs.existsSync(args.userDataDir)) {
  fs.mkdirSync(args.userDataDir);
}

if (args.listCacheFiles) {
  listCacheFiles(args.userDataDir);
  process.exit(0);
}

type WindowInfo = {
  window: BrowserWindow;
  state?: SavedWindowUIState;
};

// State of the splits
type LayoutState = {
  splitType: number,
  sliderPercent: number,
  children: LayoutState[],
};

// State of the UI inside the browser window.
// Note: These are not set at the start as the window does not yet exist.
// The renderer process will send these via saveSplitLayout and saveWinState
type SavedWindowUIState = {
  layout?: LayoutState;
  winState?: WinState;
}

// State of a BrowserWindow
type SavedWindowState = {
  bounds?: Rect,
  minimized?: boolean,
  maximized?: boolean,
  fullscreen?: boolean,
  // State of the UI inside the browser window.
  state?: SavedWindowUIState,
};

type SavedProgramState = {
  version: number;
  lastUpdateCheckDate?: number;
  windows: SavedWindowState[];
};


const progStateFilename = path.join(args.userDataDir, 'program-state.json');
const prefsFilename = path.join(args.userDataDir, 'prefs.json');
const inspectRE = new RegExp(args.inspector);
const app = electron.app;
const ipcMain = electron.ipcMain;
const shell = electron.shell;
const windowInfosById: Record<number, WindowInfo> = {};
const windows: BrowserWindow[] = [];
const oneOfAKindWindows: {
  thumber?: BrowserWindow,
  prefs?: BrowserWindow,
  password?: BrowserWindow,
  help?: BrowserWindow,
  update?: BrowserWindow,
} = {};
type OneOfAKindWindowId = keyof typeof oneOfAKindWindows;
let {prefs} = loadPrefs(prefsFilename, {
  existsSync: fs.existsSync,
  readUTF8FileSync: utils.readUTF8FileSync,
});
let oldProgState: SavedProgramState | undefined;
let hideInsteadOfCloseOneOffWindows = true;
let quitting = false;
let server: Server | undefined;
let serverPort: number = 0; 
let router: express.Router | undefined;

if (args.compareFoldersToCache) {
  const baseFolders = args._ && args._.length > 0 ? args._ : prefs.folders;
  compareFoldersToCache(baseFolders, args);
  process.exit(0);
}

// this is quite the hack. Should probably
// move windows to other file
windowTrackerInit(windows);

// TODO: use better icon. must be square. See docs
const iconPath = path.join(app.getAppPath(), 'app', 'images', 'drag-64.png');
const dragIcon = nativeImage.createFromPath(iconPath);

ipcMain.on('start', (event) => {
  const windowInfo = getWindowInfo(event.sender);
  event.sender.send('start', args, windowInfo?.state);
});
ipcMain.on('openWindow', (event, windowName) => {
  switch (windowName) {
    case 'view':
      createWindow();
      break;
    case 'prefs':
      createPreferencesWindow();
      break;
    case 'help':
      createHelpWindow();
      break;
    case 'update':
      createUpdateWindow();
      break;
    default:
      console.error('unknown window name:', windowName);
      break;
  }
});
ipcMain.on('saveSplitLayout', (event, splitLayout) => {
  setWindowInfoState(event.sender, { layout: splitLayout });
});
ipcMain.on('saveWinState', (event, winState) => {
  setWindowInfoState(event.sender, { winState });
});
ipcMain.on('getPassword', (event) => {
  event.sender.send('password', prefs.misc.password);
});
ipcMain.on('unlock', () => {
  // need to open other windows before closing passwordWindow
  // otherwise electron will quit.
  start();
  const passwordWindow = oneOfAKindWindows.password!;
  passwordWindow.close();
});
ipcMain.on('setupMenus', setupMenus);
ipcMain.on('prefs', (_event, prefs) => {
  updatePrefs(prefs);
});
ipcMain.on('showItemInFolder', (_event, fullPath) => {
  shell.showItemInFolder(fullPath);
});
ipcMain.on('openPath', (_event, fullPath) => {
  shell.openPath(fullPath);
});
ipcMain.on('dragStart', (event, file) => {
  event.sender.startDrag({ file, icon: dragIcon });
});
ipcMain.handle('deleteFile', async (_event, filename: string) => {
  await fs.promises.unlink(filename);
});
ipcMain.handle('trashItem', async (_event, filename: string) => {
  await shell.trashItem(filename);
});
ipcMain.handle('launchBrowser', async(_event, path: string) => {
  const url = new URL(`http://localhost:${serverPort}/out/vr.html`);
  url.searchParams.set('url', path);
  console.log(url.toString());
  await shell.openExternal(url.toString());
});

const staticOptions = {
  fallthrough: true,
};

function setupFolderRouter() {
  router = express.Router();
  router.use('/out', express.static(path.join(`${import.meta.dirname}/../../../out`), staticOptions));
  router.use('/user-data-dir', express.static(args.userDataDir, staticOptions));
  const isPrefs = !args._.length;
  const dirs = isPrefs ? prefs.folders : args._;
  const map = utils.dirsToPrefixMap(utils.filterNonExistingDirs(dirs));
  for (const [dir, prefix] of Object.entries(map)) {
    debug('add prefix:', prefix, 'for dir:', dir);
    router.use(`/${prefix}`, express.static(dir, staticOptions));
  }
}

function updatePrefs(newPrefs: Preferences) {
  prefs = newPrefs;

  setupFolderRouter();

  if (prefs.misc.enableWeb) {
    startWebServer();
  } else {
    stopWebServer();
  }
}

// TODO: do this only if prefs, and respond to prefs updates to turn it off and change port?
async function startWebServer() {
  if (server) {
    stopWebServer();
  }
  const app = express();
  app.use('/', router!);
  serverPort = await getFreePort(8080);
  server = app.listen(serverPort);
  debug(`Web server started on port: ${serverPort}`);
}

function stopWebServer() {
  if (server) {
    debug('Web server stopped');
    server.close();
    server = undefined;
  }
}

function getWindowInfo(webContents: WebContents): WindowInfo | undefined{
  const ndx = windows.findIndex((window) => webContents === window.webContents);
  const window = windows[ndx];
  return window ? windowInfosById[window.id] : undefined;
}

function setWindowInfoState(webContents: WebContents, state: SavedWindowUIState) {
  const windowInfo = getWindowInfo(webContents);
  if (windowInfo) {
    windowInfo.state = windowInfo.state ?? {};
    Object.assign(windowInfo.state, state);
  }
}

const s_progStatVersion = 1;
const versionConverters = new Map<number, (savedProgStat: SavedProgramState) => SavedProgramState>([
]);

function loadProgramState() {
  let progStat: SavedProgramState = {
    version: 0,
    windows: [],
  };
  try {
    const progStr = fs.readFileSync(progStateFilename, {encoding: 'utf8'});
    progStat = JSON.parse(progStr);
    while (progStat.version !== s_progStatVersion) {
      const converter = versionConverters.get(progStat.version);
      if (!converter) {
        throw new Error('bad version');
      }
      progStat = converter(progStat);
    }
  } catch {
    //
  }
  let windows = progStat.windows;
  if (!windows.length) {
    windows = [{}];
  }
  oldProgState = progStat;

  windows.forEach((winState) => {
    let needMaximized = false;
    const winBounds = winState.bounds;
    if (winBounds && winBounds.width) {
      if (!isTitlebarOnAtLeastOneDisplay(winBounds)) {
        needMaximized = putWindowOnNearestDisplay(winBounds);
      }
    }
    const window = createWindow(undefined, winBounds);
    saveWindowBounds(window, winBounds ?? window.getBounds());
    window.once('ready-to-show', () => {
      if (winState.maximized || needMaximized) {
        window.maximize();
      }
      if (winState.fullscreen) {
        window.setFullScreen(true);
      }
    });
    windowInfosById[window.id].state = winState.state;
  });
}

// We need to update this if the window is moved/resized
// so what if we save while the window is maximized we have
// the size when it wasn't.
const s_windowStates = new Map<BrowserWindow, SavedWindowState>;

function saveWindowBounds(window: BrowserWindow, bounds: Rect) {
  const state = s_windowStates.get(window) ?? {};
  s_windowStates.set(window, state);
  state.bounds = bounds;
}

function saveWindowSize(window: BrowserWindow) {
  debug('saveWindowSize');
  if (window.isMaximized() || window.isMinimized() || window.isFullScreen()) {
    return;
  }
  saveWindowBounds(window, window.getBounds());
}

function saveProgramState() {
  
  const progState: SavedProgramState = {
    version: s_progStatVersion,
    lastUpdateCheckDate: getUpdateCheckDate() ?? oldProgState?.lastUpdateCheckDate,
    windows: windows.map((window) => ({
      maximized: window.isMaximized(),
      minimized: window.isMinimized(),
      fullscreen: window.isFullScreen(),
      bounds: s_windowStates.get(window)?.bounds ?? window.getBounds(),
      state: windowInfosById[window.id].state,
    })),
  };
  fs.writeFileSync(progStateFilename, JSON.stringify(progState, null, 2));
}

function makeCloseWindowHandler(window: BrowserWindow) {
  const id = window.id;

  return function handleCloseWindow() {
    s_windowStates.delete(window);
    const ndx = windows.indexOf(window);
    windows.splice(ndx, 1);
    delete windowInfosById[id];
    window.removeListener('closed', handleCloseWindow);
    if (windows.length === 0) {
      app.quit();
    }
  };
}

function saveProgramStateIfLastWindow() {
  if (windows.length === 1 && !quitting) {
    saveProgramState();
  }
}

type WindowOptions = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  frame?: boolean;
  show?: boolean;
};

function createWindow(url?: string, options?: WindowOptions) {
  url = url || `file://${import.meta.dirname}/../../../../../app/index.html`;
  if (isDevMode) {
    url = `${url}?react_perf`;
  }
  options = options || {};
  const window = new BrowserWindow({
    x: options.x !== undefined ? options.x : undefined,
    y: options.y !== undefined ? options.y : undefined,
    width: options.width || 800,
    height: options.height || 600,
    minHeight: 500,
    minWidth: 500,
    enableLargerThanScreen: true,
    frame: options.frame === undefined ? true : options.frame,
    show: options.show === undefined ? true : options.show,
    webPreferences: {
      webSecurity: false,
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
      webviewTag: true,
    },
  });

  debug('createWindow:', url);
  window.loadURL(url);
  if (isDevMode && inspectRE.test(url)) {
    debug('openDevTools:', url);
    window.webContents.closeDevTools();
    window.webContents.setDevToolsWebContents(new BrowserWindow().webContents);
    window.webContents.openDevTools({ mode: 'detach' });
  }

  catchNavigation(window);

  window.on('close', saveProgramStateIfLastWindow);
  window.on('closed', makeCloseWindowHandler(window));
  window.on('resized', () => saveWindowSize(window))
  window.on('moved', () => saveWindowSize(window))
  windows.unshift(window);
  windowInfosById[window.id] = {
    window: window,
  };

  return window;
}

function isSafeishURL(url: string) {
  return url.startsWith('http:') || url.startsWith('https:');
}

function catchNavigation(window: BrowserWindow) {
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (isSafeishURL(url)) {
      shell.openExternal(url);
    }
  });
}

function makeHideInsteadOfCloseHandler(window: BrowserWindow) {
  return function hideInsteadOfClose(e: { preventDefault: () => void }) {
    if (hideInsteadOfCloseOneOffWindows) {
      e.preventDefault();
      window.hide();
    }
  };
}

function makeOneOfAKindCloseHandler(window: BrowserWindow, id: OneOfAKindWindowId) {
  return function handleCloseWindow() {
    delete oneOfAKindWindows[id];
    window.removeListener('closed', handleCloseWindow);
  };
}

function createOneOfAKindWindow(id: OneOfAKindWindowId, url: string, options: WindowOptions & { hideInsteadOfClose?: boolean }) {
  const openDevTools = isDevMode && inspectRE.test(url);

  let window = oneOfAKindWindows[id];
  if (window) {
    window.show();
  } else {
    options = options || {};
    window = new BrowserWindow({
      x: options.x || undefined,
      y: options.y || undefined,
      width: options.width || undefined,
      height: options.height || undefined,
      minHeight: 128,
      minWidth: 128,
      enableLargerThanScreen: true,
      frame: options.frame === undefined ? true : options.frame,
      show: openDevTools ? openDevTools : (options.show === undefined ? true : options.show),
      webPreferences: {
        webSecurity: false,
        contextIsolation: false,
        nodeIntegration: true,
        webviewTag: true,
      },
    });
  
    if (openDevTools) {
      debug('openDevTools:', url);
      window.webContents.closeDevTools();
      window.webContents.setDevToolsWebContents(new BrowserWindow().webContents);
      window.webContents.openDevTools({mode: 'detach' });
    }

    debug('createOneOfAKindWindow:', url);
    window.loadURL(`file://${import.meta.dirname}/../../../../../${url}`);

    catchNavigation(window);

    if (options.hideInsteadOfClose) {
      window.on('close', makeHideInsteadOfCloseHandler(window));
    } else {
      window.on('close', makeOneOfAKindCloseHandler(window, id));
    }
    oneOfAKindWindows[id] = window;
  }
  return window;
}

function createThumber() {
  const {width, height} = electron.screen.getPrimaryDisplay().workAreaSize;
  const size = 128;

  createOneOfAKindWindow('thumber', 'app/thumber.html', {
    ...(isDevMode ? {} : {
      x: width - size - 20,
      y: height - size - 20,
      width: size,
      height: size,
    }),
    frame: false,
    show: false,
    hideInsteadOfClose: true,
  });
}

function createPreferencesWindow() {
  createOneOfAKindWindow('prefs', 'app/preferences.html', {
    show: false,
    width: 700,
    height: 500,
    hideInsteadOfClose: true,
  });
}

function createPasswordWindow() {
  createOneOfAKindWindow('password', 'app/password.html', {
    show: true,
    width: 400,
    height: 300,
  });
}

function createHelpWindow() {
  createOneOfAKindWindow('help', 'app/help.html', {
    show: true,
    width: 700,
    height: 600,
  });
}

function createUpdateWindow() {
  createOneOfAKindWindow('update', 'app/update.html', {
    show: true,
    width: 700,
    height: 600,
    hideInsteadOfClose: true,
  });
}

function sendAction(webContents: WebContents, action: string) {
  webContents.send('action', action);
}

function setupPasswordMenus() {
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click(item, focusedWindow) {
            if (focusedWindow) (focusedWindow as BrowserWindow).reload();
          }
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: isOSX ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click(item, focusedWindow) {
            if (focusedWindow) {
              (focusedWindow as BrowserWindow).webContents.toggleDevTools();
            }
          }
        },
      ]
    },
  ];


  if (isOSX) {
    const name = electron.app.name;
    menuTemplate.unshift({
      label: name,
      submenu: [
        {
          label: `About ${name}`,
          click: createHelpWindow,
        },
        {
          label: 'Quit',
          accelerator: 'Command+Q',
          click() { app.quit(); },
        },
      ]
    });
  }

  if (!isOSX) {
    menuTemplate.unshift({
      label: 'File',
      submenu: [
        {
          label: 'Quit',
          accelerator: 'Command+Q',
          click() { app.quit(); },
        },
      ],
    });
  }

  const menu = electron.Menu.buildFromTemplate(menuTemplate);
  electron.Menu.setApplicationMenu(menu);
}

function setupMenus() {
  const fileMenuTemplate: Electron.MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'New Window',
        accelerator: 'CmdOrCtrl-N',
        click() {
          createWindow();
        },
      },
      {
        label: 'Close Window',
        accelerator: isOSX ? 'Cmd-W' : 'Alt-F4',
        click(item, focusedWindow) {
          (focusedWindow as BrowserWindow).close();
        },
      },
    ],
  };

  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    fileMenuTemplate,
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click(item, focusedWindow) {
            if (focusedWindow) (focusedWindow as BrowserWindow).reload();
          }
        },
        {
          label: 'Toggle Full Screen',
          click(item, focusedWindow) {
            if (focusedWindow) {
              sendAction((focusedWindow as BrowserWindow).webContents, 'toggleFullscreen');
            }
          }
        },
        {
          label: 'Toggle Developer Tools',
          click(item, focusedWindow) {
            if (focusedWindow) {
              (focusedWindow as BrowserWindow).webContents.toggleDevTools();
            }
          }
        },
        {
          label: 'Toggle Thumber Developer Tools',
          click() {
            if (oneOfAKindWindows.thumber) {
              oneOfAKindWindows.thumber.webContents.toggleDevTools();
            }
          }
        },
      ]
    },
    {
      label: 'Window',
      role: 'window',
      submenu: [
        {
          label: 'Minimize',
          accelerator: 'CmdOrCtrl+M',
          role: 'minimize'
        },
        {
          label: 'Toggle Full Screen',
          click(item, focusedWindow) {
            if (focusedWindow) {
              sendAction((focusedWindow as BrowserWindow).webContents, 'toggleFullscreen');
            }
          }
        },
        {
          label: 'New Window',
          click() {
            createWindow();
          },
        },
        {
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          role: 'close'
        },
      ]
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: createHelpWindow,
        },
      ]
    },
  ];

  if (isOSX) {
    const name = electron.app.name;
    menuTemplate.unshift({
      label: name,
      submenu: [
        {
          label: `About ${name}`,
          click: createHelpWindow,
        },
        {
          label: 'Check for Updates...',
          click: createUpdateWindow,
        },
        {
          label: 'Preferences...',
          click: createPreferencesWindow,
        },
        {
          type: 'separator'
        },
        {
          label: 'Services',
          role: 'services',
          submenu: []
        },
        {
          type: 'separator'
        },
        {
          label: `Hide ${name}`,
          accelerator: 'Command+H',
          role: 'hide'
        },
        {
          label: 'Hide Others',
          accelerator: 'Command+Alt+H',
          role: 'hideOthers'
        },
        {
          label: 'Show All',
          role: 'unhide'
        },
        {
          type: 'separator'
        },
        {
          label: 'Quit',
          accelerator: 'Command+Q',
          click() { app.quit(); }
        },
      ]
    });
  }

  if (!isOSX) {
    (fileMenuTemplate.submenu! as Electron.MenuItemConstructorOptions[]).push(
      {
        type: 'separator',
      },
      {
        label: 'Check for Updates...',
        click: createUpdateWindow,
      },
      {
        label: 'Preferences...',
        click: createPreferencesWindow,
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        accelerator: 'Command+Q',
        click() { app.quit(); }
      },
    );
  }

  const menu = electron.Menu.buildFromTemplate(menuTemplate);
  electron.Menu.setApplicationMenu(menu);
}

const s_minMsBetweenUpdateChecks = 7 *  24 * 60 * 60 * 1000;  // 7 days
function start() {
  updatePrefs(prefs);
  setupMenus();
  createThumber();
  createPreferencesWindow();
  loadProgramState();
  if (!isDevMode && prefs && prefs.misc && prefs.misc.checkForUpdates) {
    if (!oldProgState ||
        !oldProgState.lastUpdateCheckDate ||
        Date.now() - oldProgState.lastUpdateCheckDate > s_minMsBetweenUpdateChecks) {
      // TODO: turn this on when it actually works
      // createUpdateWindow();
    }
  }
}

app.on('ready', () => {
  if (prefs && prefs.misc && prefs.misc.password) {
    setupPasswordMenus();
    createPasswordWindow();
  } else {
    start();
  }
});

app.on('before-quit', () => {
  const passwordWindow = oneOfAKindWindows.password;
  if (!passwordWindow && windows.length) {
    saveProgramState();
  }
  quitting = true;
  hideInsteadOfCloseOneOffWindows = false;
  for (const window of Object.values(oneOfAKindWindows)) {
    window.close();
  }
});

app.on('window-all-closed', () => {
  stopWebServer();
  app.quit();
});

app.on('will-quit', () => {
  // TODO: On macOS, Electron's C++ layer waits ~20s for renderer child processes to
  // exit. It's not clear why. This is a hack that should be removed.
  process.kill(process.pid, 'SIGKILL');
});

app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'webview') {
    contents.on('will-navigate', (event, url) => {
      event.preventDefault();
      shell.openExternal(url);
    });
  }
});

app.on('activate', () => {
  const passwordWindow = oneOfAKindWindows.password;
  if (windows.length === 0 && !passwordWindow) {
    createWindow();
  }
});
