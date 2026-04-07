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

import React from 'react';
import { render as reactRender } from 'react-dom';

import { ipcRenderer } from 'electron';   
import { getCurrentWindow, Menu, MenuItem } from '@electron/remote';
import App from './app';
import '../../lib/stacktrace-log';
import '../../lib/title';

const isDevMode = process.env.NODE_ENV === 'development';

if (isDevMode) {
  let rightClickPosition: { x: number; y: number } | null = null;

  const menu = new Menu();
  menu.append(new MenuItem({
    label: 'Inspect Element',
    click: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (getCurrentWindow().webContents as any).inspectElement(rightClickPosition!.x, rightClickPosition!.y);
    },
  }));

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    menu.popup({ window: getCurrentWindow() });
  }, false);

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    rightClickPosition = { x: e.x, y: e.y };
    menu.popup({ window: getCurrentWindow() });
  }, false);
}

// we can print this value to see if code is getting executed on the same frame
(window as Window & typeof globalThis & { frameCountNumber: number; frameCount: string }).frameCountNumber = 0;
function advanceFrame(): void {
  const w = window as Window & typeof globalThis & { frameCountNumber: number; frameCount: string };
  ++w.frameCountNumber;
  w.frameCount = `frame#${w.frameCountNumber}`;
  requestAnimationFrame(advanceFrame);
}

if (isDevMode) {
  requestAnimationFrame(advanceFrame);
}

type StartArgs = {
  columnWidth: number;
  padding: number;
  maxSeekTime: number;
  currentVPairNdx: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function start(_args: unknown, startState: any): void {
  const g: StartArgs = {
    columnWidth: 160,
    padding: 10,
    maxSeekTime: 30,
    currentVPairNdx: 0,
  };

  setTimeout(() => {
    reactRender(
      <App options={g} startState={startState} />,
      document.querySelector('.browser'),
    );
  }, isDevMode ? 1000 : 100);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
ipcRenderer.on('start', (_event, args: unknown, startState: any) => {
  start(args, startState);
});
ipcRenderer.send('start');
