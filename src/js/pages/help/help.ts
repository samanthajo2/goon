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

import { shell, ipcRenderer } from 'electron';   
import path from 'node:path';
import { version } from '../../../../package.json';
import '../../lib/title';

type StartArgs = {
  userDataDir: string;
};

function start(args: StartArgs): void {
  const prefspath = path.join(args.userDataDir, 'prefs.json');
  const $ = document.querySelector.bind(document);
  ($('#version') as HTMLElement).textContent = version;
  ($('#exepath') as HTMLElement).textContent = process.argv[0];
  const prefsElem = $('#prefspath') as HTMLElement;
  prefsElem.textContent = prefspath;
  prefsElem.addEventListener('click', () => {
    shell.showItemInFolder(prefspath);
  });
  document.querySelectorAll<HTMLElement>('[data-platform]').forEach((elem) => {
    if (elem.dataset.platform !== process.platform) {
      elem.style.display = 'none';
    }
  });
}

ipcRenderer.on('start', (_event, args: StartArgs) => {
  start(args);
});
ipcRenderer.send('start');
