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

import {ipcMain} from 'electron';  // eslint-disable-line
import {autoUpdater} from 'electron-updater';

let g_webContent;
let g_checkDate;

[
  'error',
  'checking-for-update',
  'update-available',
  'update-not-available',
  'update-downloaded',
  'download-progress',
].forEach((event) => {
  autoUpdater.on(event, (...args) => {
    if (g_webContent) {
      g_webContent.send(event, ...args);
    } else {
      console.error('no window for event:', event);
    }
  });
});

ipcMain.on('checkForUpdate', (e) => {
  g_webContent = e.sender;
  try {
    autoUpdater.checkForUpdates();
  } catch (e) {
    g_webContent.send('error', e.toString());
  }
});

ipcMain.on('quitAndInstall', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.on('checkedForUpdate', () => {
  g_checkDate = Date.now();
});

function getUpdateCheckDate() {
  return g_checkDate;
}

export {
  getUpdateCheckDate,  // eslint-disable-line
};
