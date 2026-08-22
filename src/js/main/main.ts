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
import os from 'node:os';
import { spawn } from 'node:child_process';
import { Server } from 'http'
import { Command } from 'commander';
import debugFn from 'debug';
import express from 'express';
import electron, { BrowserWindow, nativeImage, type WebContents } from '../lib/electron-imports.js';
import { initRelay } from '../lib/window-ipc.js';

import '../lib/update-manager.js';
import { autoUpdater } from './auto-update.js';
import appdata from '../lib/appdata.js';
import * as utils from '../lib/utils.js';
import { getFreePort } from '../lib/get-free-port.js';
import {loadPrefs, Preferences} from '../pages/prefs/default-prefs.js';
import * as fsOps from './fs-ops.js';
import { actionAccelerator } from './menu-accelerator.js';
import { actions, type ActionId } from '../lib/actions.js';
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
import { startWebSocketBridge } from './ws-bridge.js';

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

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

// When GOON_DUMP_IDLE is set, every 15s we dump what's keeping the main
// event loop alive (timers, sockets, filesystem watchers, ...). Use this
// to find what's firing during "idle" periods that might be triggering
// the V8 main-process crashes.
if (process.env.GOON_DUMP_IDLE) {
  const summarize = (label: string, items: unknown[]): string => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const named = item as { constructor?: { name?: string } } | null | undefined;
      const ctorName = named?.constructor?.name ?? typeof item;
      counts[ctorName] = (counts[ctorName] ?? 0) + 1;
    }
    const parts = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ');
    return `${label}(${items.length}): ${parts || '<none>'}`;
  };
  setInterval(() => {
    // _getActiveHandles / _getActiveRequests are undocumented but stable
    // and widely used for diagnosing event-loop activity.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc = process as any;
    const handles = proc._getActiveHandles?.() ?? [];
    const requests = proc._getActiveRequests?.() ?? [];
    const mem = process.memoryUsage();
    console.log(
      `[idle-dump] ${new Date().toISOString()} ` +
      `rss=${Math.round(mem.rss / 1024 / 1024)}MiB heap=${Math.round(mem.heapUsed / 1024 / 1024)}/${Math.round(mem.heapTotal / 1024 / 1024)}MiB ` +
      summarize('handles', handles) + ' | ' +
      summarize('requests', requests),
    );
  }, 15000).unref();
}

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
  browser?: BrowserWindow,
} = {};
type OneOfAKindWindowId = keyof typeof oneOfAKindWindows;
let {prefs} = loadPrefs(prefsFilename, {
  existsSync: fs.existsSync,
  readUTF8FileSync: utils.readUTF8FileSync,
});
let hideInsteadOfCloseOneOffWindows = true;
let quitting = false;
let server: Server | undefined;
let serverPort: number = 0;
let router: express.Router | undefined;
let wsServer: import('ws').WebSocketServer | undefined;

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
ipcMain.on('dragStart', (event, fileOrFiles: string | string[]) => {
  if (Array.isArray(fileOrFiles) && fileOrFiles.length > 0) {
    // The TS type requires `file` even when `files` is used; pass the first as the fallback.
    event.sender.startDrag({ file: fileOrFiles[0], files: fileOrFiles, icon: dragIcon });
  } else {
    const file = Array.isArray(fileOrFiles) ? fileOrFiles[0] : fileOrFiles;
    event.sender.startDrag({ file, icon: dragIcon });
  }
});
ipcMain.handle('deleteFile', (_event, filename: string) => fsOps.deleteFile(fs, filename));
ipcMain.handle('deleteFolder', (_event, dir: string) => fsOps.deleteFolder(fs, dir));
ipcMain.handle('createFolder', (_event, parentDir: string) => fsOps.createFolder(fs, parentDir));
ipcMain.handle('renameFolder', (_event, src: string, dest: string) => fsOps.renameFolder(fs, src, dest));
ipcMain.handle('moveFileToDir', (_event, src: string, destDir: string) => fsOps.moveFileToDir(fs, src, destDir));
ipcMain.handle('copyFileToDir', (_event, src: string, destDir: string) => fsOps.copyFileToDir(fs, src, destDir));
ipcMain.handle('launchBrowser', async(_event, path: string) => {
  const url = new URL(`http://localhost:${serverPort}/out/vr.html`);
  url.searchParams.set('url', path);
  console.log(url.toString());
  await shell.openExternal(url.toString());
});
ipcMain.handle('launchExternalViewer', async (_event: unknown, exePath: string, filePath: string) => {
  spawn(exePath, [filePath], { detached: true, stdio: 'ignore' }).unref();
});
ipcMain.handle('checkFileExists', async (_event: unknown, filePath: string) => {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
});

const staticOptions = {
  fallthrough: true,
};

function setupFolderRouter() {
  router = express.Router();
  // Project root: compiled main.js lives at out/js/src/js/main/main.js, so
  // we walk up five levels to reach the repo root where app/ and out/ sit.
  const repoRoot = path.join(import.meta.dirname, '..', '..', '..', '..', '..');
  // Static app/ assets (external.html, app.css, images/, ...). external.html
  // is the index served at "/" for browser clients.
  router.use('/', express.static(path.join(repoRoot, 'app'), { ...staticOptions, index: 'external.html' }));
  router.use('/out', express.static(path.join(repoRoot, 'out'), staticOptions));
  router.use('/user-data-dir', express.static(args.userDataDir, staticOptions));
  // Config endpoint consumed by web-platform.ts on boot — exposes the
  // folder→prefix map and userDataDir so the client can translate file
  // paths to URLs the express folder router will serve.
  router.get('/api/config', (_req, res) => {
    const cfgIsPrefs = !args._.length;
    const cfgDirs = cfgIsPrefs ? prefs.folders : args._;
    res.json({
      folders: utils.dirsToPrefixMap(utils.filterNonExistingDirs(cfgDirs)),
      userDataDir: args.userDataDir,
    });
  });
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

  // Rebuild menus so accelerators reflect the latest keybindings.
  // Skip on initial call (before the app has finished starting) — start() will
  // call setupMenus() itself.
  if (electron.app.isReady() && electron.Menu.getApplicationMenu()) {
    setupMenus();
  }

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
  const expressApp = express();
  expressApp.use('/', router!);
  serverPort = await getFreePort(8080);
  console.log(`[web] starting server on port: ${serverPort}`);
  const localServer = expressApp.listen(serverPort);
  // Surface bind failures (and any later runtime errors) to stderr instead
  // of letting them propagate to Electron's default crash dialog.
  localServer.on('error', (err) => {
    console.error('[web] server error:', err);
  });
  localServer.on('listening', () => {
    console.log(`[web] server listening on ${serverPort}`);
    broadcastBrowserServerState();
  });
  server = localServer;
  // Mount the WebSocket bridge so browsers can talk to the same channels
  // (thumber, prefs, ...) that the desktop view window does.
  wsServer = startWebSocketBridge(server);
  debug(`Web server started on port: ${serverPort}`);
  broadcastBrowserServerState();
}

function stopWebServer() {
  if (wsServer) {
    wsServer.close();
    wsServer = undefined;
  }
  if (server) {
    debug('Web server stopped');
    server.close();
    server = undefined;
  }
  serverPort = 0;
  broadcastBrowserServerState();
}

// ── Browser-server window IPC ──────────────────────────────────────────
// The "Start Server" window (browser.tsx) shows the current server URLs,
// can launch them in a system browser, and renders a QR code so a phone
// on the same wifi can scan and connect.

function getBrowserServerUrls(port: number): string[] {
  if (!port) return [];
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (host: string): void => {
    const url = `http://${host}:${port}/`;
    if (seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  // Walk every non-internal IPv4/IPv6 interface — these are the ones a
  // phone or other device on the LAN can actually reach.
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const info of list) {
      if (info.internal) continue;
      if (info.family === 'IPv4') add(info.address);
      else if (info.family === 'IPv6') add(`[${info.address}]`);
    }
  }
  add('localhost');
  return urls;
}

type BrowserServerState = {
  running: boolean;
  port: number;
  urls: string[];
};

function getBrowserServerState(): BrowserServerState {
  const running = !!server && serverPort > 0;
  return {
    running,
    port: serverPort,
    urls: running ? getBrowserServerUrls(serverPort) : [],
  };
}

function broadcastBrowserServerState(): void {
  const state = getBrowserServerState();
  const window = oneOfAKindWindows.browser;
  if (window && !window.isDestroyed()) {
    window.webContents.send('browser:state', state);
  }
}

ipcMain.handle('browser:getServerState', () => getBrowserServerState());
ipcMain.on('browser:startServer', () => {
  startWebServer();
});
ipcMain.on('browser:stopServer', () => {
  stopWebServer();
});

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
  installCrashRecovery(window);

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

// Auto-recover from renderer crashes (e.g. macOS killing the process after
// a long sleep, or OOM). Without this the user sees a frozen white window
// with no recourse short of restarting the app.
function installCrashRecovery(window: BrowserWindow) {
  window.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] renderer gone:', details.reason, 'exitCode:', details.exitCode, 'url:', window.webContents.getURL());
    if (window.isDestroyed()) return;
    // 'clean-exit' / 'killed' for normal close; reload only on actual crashes.
    const recoverable = ['crashed', 'oom', 'launch-failed', 'integrity-failure', 'abnormal-exit'];
    if (recoverable.includes(details.reason)) {
      try { window.reload(); } catch (err) { console.error('[main] reload failed:', err); }
    }
  });
  window.webContents.on('unresponsive', () => {
    console.warn('[main] renderer unresponsive:', window.webContents.getURL());
  });
  // Surface renderer-side failures in the main process log. Without this,
  // uncaught errors in a renderer (e.g. a module failing to load in a packaged
  // build) are only visible in that window's DevTools console — invisible when
  // running the shipped app from a terminal, making such bugs very hard to find.
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning') {
      console.error(`[renderer:${details.level}] ${window.webContents.getURL()}: ${details.message} (${details.sourceId}:${details.lineNumber})`);
    }
  });
  window.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error(`[main] did-fail-load: ${errorCode} ${errorDescription} url: ${validatedURL}`);
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
    installCrashRecovery(window);

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

function createBrowserServerWindow() {
  createOneOfAKindWindow('browser', 'app/browser.html', {
    show: true,
    width: 600,
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
  // Helper to make a menu item that dispatches an app action to the focused window.
  // Label defaults to actions[id].desc; accelerator is looked up from the user's
  // keyConfig so menus reflect the current bindings.
  const actionItem = (
    actionId: ActionId,
    extra?: Partial<Electron.MenuItemConstructorOptions>,
  ): Electron.MenuItemConstructorOptions => ({
    label: actions[actionId].desc,
    accelerator: actionAccelerator(actionId, prefs.keyConfig),
    click(_item, focusedWindow) {
      if (focusedWindow) {
        sendAction((focusedWindow as BrowserWindow).webContents, actionId);
      }
    },
    ...extra,
  });

  const editSubmenu: Electron.MenuItemConstructorOptions[] = [
    { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
    { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
    { type: 'separator' },
    { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
    { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
    { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
    { type: 'separator' },
    actionItem('selectAll'),
    actionItem('clearSelection'),
    { type: 'separator' },
    actionItem('trashSelected'),
  ];

  const viewSubmenu: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Reload',
      accelerator: 'CmdOrCtrl+R',
      click(_item, focusedWindow) {
        if (focusedWindow) (focusedWindow as BrowserWindow).reload();
      },
    },
    { type: 'separator' },
    actionItem('zoomIn'),
    actionItem('zoomOut'),
    actionItem('resetZoom'),
    { type: 'separator' },
    actionItem('splitHorizontal'),
    actionItem('splitVertical'),
    actionItem('deletePane'),
    { type: 'separator' },
    actionItem('rotate'),
    actionItem('cycleGridMode'),
    actionItem('cycleSortMode'),
    {
      label: actions.toggleShowEmptyFolders.desc,
      type: 'checkbox',
      checked: !!prefs.misc.showEmpty,
      accelerator: actionAccelerator('toggleShowEmptyFolders', prefs.keyConfig),
      click(_item, focusedWindow) {
        if (focusedWindow) sendAction((focusedWindow as BrowserWindow).webContents, 'toggleShowEmptyFolders');
      },
    },
    { type: 'separator' },
    {
      label: 'Toggle Developer Tools',
      accelerator: isOSX ? 'Alt+Command+I' : 'Ctrl+Shift+I',
      click(_item, focusedWindow) {
        if (focusedWindow) (focusedWindow as BrowserWindow).webContents.toggleDevTools();
      },
    },
    {
      label: 'Toggle Thumber Developer Tools',
      click() {
        if (oneOfAKindWindows.thumber) {
          oneOfAKindWindows.thumber.webContents.toggleDevTools();
        }
      },
    },
  ];

  const actionsSubmenu: Electron.MenuItemConstructorOptions[] = [
    actionItem('newVirtualFolder'),
    actionItem('refreshFolders'),
    { type: 'separator' },
    actionItem('toggleRecording'),
  ];

  const windowSubmenu: Electron.MenuItemConstructorOptions[] = [
    { label: 'Minimize', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
    actionItem('toggleFullscreen'),
    actionItem('newWindow'),
    { label: 'Close', accelerator: 'CmdOrCtrl+W', role: 'close' },
  ];

  const helpSubmenu: Electron.MenuItemConstructorOptions[] = [
    { label: 'Learn More', click: createHelpWindow },
  ];

  const menuTemplate: Electron.MenuItemConstructorOptions[] = [];

  if (isOSX) {
    const name = electron.app.name;
    menuTemplate.push({
      label: name,
      submenu: [
        { label: `About ${name}`, click: createHelpWindow },
        { label: 'Check for Updates...', click: createUpdateWindow },
        { label: 'Preferences...', click: createPreferencesWindow },
        { label: 'Start Server...', click: createBrowserServerWindow },
        { type: 'separator' },
        { label: 'Services', role: 'services', submenu: [] },
        { type: 'separator' },
        { label: `Hide ${name}`, accelerator: 'Command+H', role: 'hide' },
        { label: 'Hide Others', accelerator: 'Command+Alt+H', role: 'hideOthers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Command+Q', click() { app.quit(); } },
      ],
    });
  } else {
    // Windows/Linux: a File menu replaces the missing Mac App menu.
    menuTemplate.push({
      label: 'File',
      submenu: [
        actionItem('newWindow'),
        { type: 'separator' },
        { label: 'Preferences...', click: createPreferencesWindow },
        { label: 'Start Server...', click: createBrowserServerWindow },
        { label: 'Check for Updates...', click: createUpdateWindow },
        { type: 'separator' },
        { label: 'Close Window', accelerator: 'Alt+F4', click(_i, w) { (w as BrowserWindow)?.close(); } },
        { label: 'Quit', accelerator: 'Ctrl+Q', click() { app.quit(); } },
      ],
    });
  }

  menuTemplate.push(
    { label: 'Edit', submenu: editSubmenu },
    { label: 'View', submenu: viewSubmenu },
    { label: 'Actions', submenu: actionsSubmenu },
    { label: 'Window', role: 'window', submenu: windowSubmenu },
    { label: 'Help', role: 'help', submenu: helpSubmenu },
  );

  const menu = electron.Menu.buildFromTemplate(menuTemplate);
  electron.Menu.setApplicationMenu(menu);
}

function start() {
  updatePrefs(prefs);
  setupMenus();
  createThumber();
  createPreferencesWindow();
  loadProgramState();
  if (!isDevMode && prefs && prefs.misc && prefs.misc.checkForUpdates) {
    // Silent background check: only surface the update window if a new
    // version is actually available. The user must explicitly opt into the
    // download from there.
    autoUpdater.once('update-available', () => {
      createUpdateWindow();
    });
    autoUpdater.checkForUpdates();
  }
}

app.on('ready', () => {
  setupDisplayMediaHandler();
  if (prefs && prefs.misc && prefs.misc.password) {
    setupPasswordMenus();
    createPasswordWindow();
  } else {
    start();
  }
});

// Auto-answer getDisplayMedia (used by the in-app recorder) with the requesting
// window itself, so there's no source picker. Audio is mixed in the renderer from
// the playing media elements, so we only supply video here.
function setupDisplayMediaHandler() {
  electron.session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    electron.desktopCapturer.getSources({ types: ['window', 'screen'] }).then((sources) => {
      const win = BrowserWindow.getFocusedWindow();
      const match = win ? sources.find((s) => s.name === win.getTitle()) : undefined;
      const source = match ?? sources[0];
      // No source → cancel the request rather than throw.
      callback(source ? { video: source } : {} as Electron.Streams);
    }).catch((err) => {
      console.error('setDisplayMediaRequestHandler:', err);
      callback({} as Electron.Streams);
    });
  });
}

ipcMain.handle('saveRecording', async (e, bytes: Uint8Array, defaultName: string) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await electron.dialog.showSaveDialog(win!, {
    defaultPath: defaultName,
    filters: [{ name: 'WebM Video', extensions: ['webm'] }],
  });
  if (canceled || !filePath) return false;
  await fs.promises.writeFile(filePath, Buffer.from(bytes));
  return true;
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
