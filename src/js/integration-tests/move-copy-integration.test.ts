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

// End-to-end drag-and-drop file operations (copy / move between native folders)
// through the real handlers + shared fs-ops on an in-memory fs.

import { describe, it, afterEach } from '../lib/test/mocha.js';
import { assert } from 'chai';
import { makeHarness, Harness } from '../test-support/harness.js';

const filesOf = (h: Harness, key: string): string[] =>
  (h.folder(key)?.files ?? []).map(f => f.info.filename);

describe('integration: move/copy flows (view ↔ thumber ↔ fs)', function () {
  this.timeout(15000);
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  it('copies a file into another folder, leaving the original', async () => {
    h = makeHarness({ tree: { '/a': { 'x.jpg': '1' }, '/b': { 'keep.jpg': '2' } }, folders: ['/a', '/b'] });
    await h.waitFor(() => filesOf(h!, '/a').includes('/a/x.jpg') && filesOf(h!, '/b').includes('/b/keep.jpg'));

    h.send('copyFiles', ['/a/x.jpg'], '/b');

    await h.waitFor(() => filesOf(h!, '/b').includes('/b/x.jpg'));
    assert.isTrue(h.vol.existsSync('/a/x.jpg'), 'original stays');
    assert.isTrue(h.vol.existsSync('/b/x.jpg'), 'copy created on disk');
    assert.isTrue(filesOf(h, '/a').includes('/a/x.jpg'), 'still in source folder');
  });

  it('moves a file: gone from source (disk + folder), present in destination', async () => {
    h = makeHarness({ tree: { '/a': { 'x.jpg': '1' }, '/b': { 'keep.jpg': '2' } }, folders: ['/a', '/b'] });
    await h.waitFor(() => filesOf(h!, '/a').includes('/a/x.jpg'));

    h.send('moveFiles', ['/a/x.jpg'], '/b');

    await h.waitFor(() => filesOf(h!, '/b').includes('/b/x.jpg') && !filesOf(h!, '/a').includes('/a/x.jpg'));
    assert.isFalse(h.vol.existsSync('/a/x.jpg'), 'removed from source on disk');
    assert.isTrue(h.vol.existsSync('/b/x.jpg'), 'present in destination on disk');
  });

  it('deduplicates on collision (copy x.jpg where x.jpg exists → "x 2.jpg")', async () => {
    h = makeHarness({ tree: { '/a': { 'x.jpg': '1' }, '/b': { 'x.jpg': '2' } }, folders: ['/a', '/b'] });
    await h.waitFor(() => filesOf(h!, '/a').includes('/a/x.jpg') && filesOf(h!, '/b').includes('/b/x.jpg'));

    h.send('copyFiles', ['/a/x.jpg'], '/b');

    await h.waitFor(() => filesOf(h!, '/b').includes('/b/x 2.jpg'));
    assert.isTrue(h.vol.existsSync('/b/x.jpg'), 'existing file untouched');
    assert.isTrue(h.vol.existsSync('/b/x 2.jpg'), 'deduped copy created on disk');
  });
});
