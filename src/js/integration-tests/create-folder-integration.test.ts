/*
Copyright 2026 SamanthaJo

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

// End-to-end (view ↔ thumber over a loopback, on memfs) tests for the "New Folder"
// and "New Virtual Folder" flows — the exact bug the harness was built to catch.

import { describe, it, afterEach } from '../lib/test/mocha.js';
import { assert } from 'chai';
import { makeHarness, Harness } from '../test-support/harness.js';

const virtualKeys = (h: Harness) => h.folderNames().filter(k => k.startsWith('vfolder:'));

describe('integration: create folder (view ↔ thumber ↔ fs)', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  it('creates a native "Untitled" subfolder that appears under Show Empty Folders', async () => {
    h = makeHarness({ tree: { '/vol': { 'a.jpg': 'x' } }, folders: ['/vol'], showEmpty: true });
    await h.waitFor(() => h!.folderNames().includes('/vol'));

    h.send('createFolder', '/vol');

    await h.waitFor(() => h!.folderNames().includes('/vol/Untitled'));
    assert.isTrue(h.vol.existsSync('/vol/Untitled'), 'folder created on the filesystem');
    assert.strictEqual(h.folder('/vol/Untitled')!.name, 'Untitled');
  });

  it('a second New Folder makes "Untitled 2" (deduped)', async () => {
    h = makeHarness({ tree: { '/vol': { 'a.jpg': 'x' } }, folders: ['/vol'], showEmpty: true });
    await h.waitFor(() => h!.folderNames().includes('/vol'));

    h.send('createFolder', '/vol');
    await h.waitFor(() => h!.folderNames().includes('/vol/Untitled'));
    h.send('createFolder', '/vol');
    await h.waitFor(() => h!.folderNames().includes('/vol/Untitled 2'));
  });

  it('a brand-new empty virtual folder appears in the folder tree', async () => {
    h = makeHarness({ folders: [], showEmpty: true });

    h.send('createVirtualFolder', 'bar');

    await h.waitFor(() => virtualKeys(h!).length === 1);
    const key = virtualKeys(h)[0];
    assert.strictEqual(h.folder(key)!.name, 'bar', 'shows its name, not its id');
  });

  it('New Virtual Folder on a virtual folder creates another, uniquely named', async () => {
    h = makeHarness({ folders: [], showEmpty: true });
    h.send('createVirtualFolder', 'bar');
    await h.waitFor(() => virtualKeys(h!).length === 1);

    h.send('createFolder', virtualKeys(h)[0]); // right-click the vfolder → New Virtual Folder

    await h.waitFor(() => virtualKeys(h!).length === 2);
    const names = virtualKeys(h).map(k => h!.folder(k)!.name).sort();
    assert.deepEqual(names, ['Untitled', 'bar']);
  });
});
