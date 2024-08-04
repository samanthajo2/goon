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
import {ipcRenderer} from 'electron';  // eslint-disable-line
import {getCurrentWindow, Menu} from '@electron/remote';

const isOSX = process.platform === 'darwin';

const g_timeUntilMenuMs = 1000;
const g_menuAreaHeight = 2;

let timeoutId;
let menuShowing = true;

function checkMenu(e) {
  if (e.clientY <= g_menuAreaHeight) {
    if (!timeoutId) {
      timeoutId = setTimeout(() => {
        timeoutId = undefined;
        showMenu();
      }, g_timeUntilMenuMs);
    }
  } else {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    hideMenu();
  }
}

function hideMenu(force) {
  if (menuShowing || force) {
    menuShowing = false;
    getCurrentWindow().setMenu(null);
    Menu.setApplicationMenu(null);
  }
}

function showMenu() {
  if (!menuShowing) {
    menuShowing = true;
    ipcRenderer.send('setupMenus');
  }
}

function installFullscreenHandler(force) {
  if (!isOSX) {
    hideMenu(force);
    window.addEventListener('mousemove', checkMenu);
  }
}

function setupFullscreen() {
  const isFullscreen = getCurrentWindow().isFullScreen();
  if (isFullscreen) {
    installFullscreenHandler(true);
  }
}

function enterFullscreen() {
  getCurrentWindow().setFullScreen(true);
  // you can't remove the menus in OSX
  installFullscreenHandler();
}

function exitFullscreen() {
  getCurrentWindow().setFullScreen(false);
  if (!isOSX) {
    window.removeEventListener('mousemove', checkMenu);
    showMenu();
  }
}

function toggleFullscreen() {
  const isFullscreen = getCurrentWindow().isFullScreen();
  if (isFullscreen) {
    exitFullscreen();
  } else {
    enterFullscreen();
  }
}

export {
  setupFullscreen,
  toggleFullscreen,
};
