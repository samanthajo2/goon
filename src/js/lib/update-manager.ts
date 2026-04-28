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

import { ipcMain, type WebContents } from './electron-imports.js';
import { autoUpdater } from '../main/auto-update.js';

let g_webContent: WebContents | undefined;

([
  'error',
  'checking-for-update',
  'update-available',
  'update-not-available',
  'update-downloaded',
  'download-progress',
] as const).forEach((event) => {
  autoUpdater.on(event, (...args: unknown[]) => {
    if (g_webContent) {
      // Errors from Node need to be stringified for IPC; everything else is plain JSON.
      const safeArgs = args.map(a => a instanceof Error ? String(a) : a);
      g_webContent.send(event, ...safeArgs);
    }
  });
});

ipcMain.on('checkForUpdate', (e, force?: boolean) => {
  g_webContent = e.sender;
  autoUpdater.checkForUpdates(!!force);
});

ipcMain.on('downloadUpdate', () => {
  autoUpdater.downloadUpdate();
});

ipcMain.on('quitAndInstall', () => {
  autoUpdater.quitAndInstall();
});
