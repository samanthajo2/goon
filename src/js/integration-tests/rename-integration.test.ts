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

// End-to-end rename flows: a native folder is renamed on disk and the tree updates
// (proactively, without relying on the OS watcher); a virtual folder renames in
// place; a duplicate virtual-folder name is rejected.

import { describe, it, afterEach } from '../lib/test/mocha.js';
import { assert } from 'chai';
import { makeHarness, Harness } from '../test-support/harness.js';

const vKey = (h: Harness): string | undefined => h.folderNames().find(k => k.startsWith('vfolder:'));

describe('integration: rename flows (view ↔ thumber ↔ fs)', function () {
  this.timeout(15000);
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  it('renames a native folder on disk and updates the tree', async () => {
    h = makeHarness({ tree: { '/vol': { sub: { 'c.jpg': 'x' } } }, folders: ['/vol'] });
    await h.waitFor(() => h!.folderNames().includes('/vol/sub'));

    h.send('renameFolder', '/vol/sub', 'renamed');

    await h.waitFor(() => h!.folderNames().includes('/vol/renamed'));
    assert.isFalse(h.folderNames().includes('/vol/sub'), 'old folder gone from tree');
    assert.isTrue(h.vol.existsSync('/vol/renamed/c.jpg'), 'renamed on the filesystem');
    assert.isFalse(h.vol.existsSync('/vol/sub'), 'old path gone from the filesystem');
  });

  it('renames a virtual folder in place', async () => {
    h = makeHarness({ folders: [], showEmpty: true });
    h.send('createVirtualFolder', 'bar');
    await h.waitFor(() => !!vKey(h!) && h!.folder(vKey(h!)!)!.name === 'bar');
    const key = vKey(h)!;

    h.send('renameFolder', key, 'baz');

    await h.waitFor(() => h!.folder(key)?.name === 'baz');
    assert.strictEqual(h.folder(key)!.filename, key, 'same synthetic key');
  });

  it('rejects renaming a virtual folder to a name already in use', async () => {
    h = makeHarness({ folders: [], showEmpty: true });
    h.send('createVirtualFolder', 'one');
    h.send('createVirtualFolder', 'two');
    await h.waitFor(() => h!.folderNames().filter(k => k.startsWith('vfolder:')).length === 2);
    const twoKey = h.folderNames().filter(k => k.startsWith('vfolder:'))
      .find(k => h!.folder(k)!.name === 'two')!;

    h.send('renameFolder', twoKey, 'one'); // clashes

    await h.settle(120);
    assert.strictEqual(h.folder(twoKey)!.name, 'two', 'name unchanged after rejected rename');
  });
});
