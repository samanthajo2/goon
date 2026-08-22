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

// End-to-end delete flows through the real view ↔ thumber pipeline on an in-memory
// fs: trashing a real file, unlinking a virtual-folder reference (file untouched),
// and deleting a real file that a virtual folder references (drops from both).

import { describe, it, afterEach } from '../lib/test/mocha.js';
import { assert } from 'chai';
import { makeHarness, Harness } from '../test-support/harness.js';

const filesOf = (h: Harness, key: string): string[] =>
  (h.folder(key)?.files ?? []).map(f => f.info.filename);
const vKey = (h: Harness): string | undefined => h.folderNames().find(k => k.startsWith('vfolder:'));

describe('integration: delete flows (view ↔ thumber ↔ fs)', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  it('trashing a real file removes it from the folder and the filesystem', async () => {
    h = makeHarness({ tree: { '/vol': { 'a.jpg': 'x', 'b.jpg': 'y' } }, folders: ['/vol'] });
    await h.waitFor(() => filesOf(h!, '/vol').includes('/vol/a.jpg') && filesOf(h!, '/vol').includes('/vol/b.jpg'));

    h.send('deleteEntries', [{ folderKey: '/vol', filename: '/vol/a.jpg' }]);

    await h.waitFor(() => !filesOf(h!, '/vol').includes('/vol/a.jpg'));
    assert.isFalse(h.vol.existsSync('/vol/a.jpg'), 'deleted from the filesystem');
    assert.isTrue(h.vol.existsSync('/vol/b.jpg'), 'sibling untouched');
    assert.deepEqual(filesOf(h, '/vol'), ['/vol/b.jpg']);
  });

  it('removing a virtual-folder entry unlinks the reference but leaves the file on disk', async () => {
    h = makeHarness({ tree: { '/vol': { 'a.jpg': 'x' } }, folders: ['/vol'] });
    h.send('addToNewVirtualFolder', 'fav', [{ path: '/vol/a.jpg' }]);
    await h.waitFor(() => !!vKey(h!) && filesOf(h!, vKey(h!)!).includes('/vol/a.jpg'));
    const key = vKey(h)!;

    h.send('deleteEntries', [{ folderKey: key, filename: '/vol/a.jpg' }]);

    await h.waitFor(() => !filesOf(h!, key).includes('/vol/a.jpg'));
    assert.isTrue(h.vol.existsSync('/vol/a.jpg'), 'real file untouched');
    assert.isTrue(filesOf(h, '/vol').includes('/vol/a.jpg'), 'still in its native folder');
  });

  it('deleting a real file also drops it from a virtual folder that references it', async () => {
    h = makeHarness({ tree: { '/vol': { 'a.jpg': 'x' } }, folders: ['/vol'] });
    h.send('addToNewVirtualFolder', 'fav', [{ path: '/vol/a.jpg' }]);
    await h.waitFor(() => !!vKey(h!) && filesOf(h!, vKey(h!)!).includes('/vol/a.jpg'));
    const key = vKey(h)!;

    h.send('deleteEntries', [{ folderKey: '/vol', filename: '/vol/a.jpg' }]);

    await h.waitFor(() => !filesOf(h!, key).includes('/vol/a.jpg') && !filesOf(h!, '/vol').includes('/vol/a.jpg'));
    assert.isFalse(h.vol.existsSync('/vol/a.jpg'), 'gone from disk');
  });
});
