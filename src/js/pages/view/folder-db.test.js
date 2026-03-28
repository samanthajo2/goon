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

import { describe, it, beforeEach } from '../../lib/test/mocha';
import { assert } from 'chai';
import FolderDB from './folder-db';

describe('FolderDB', () => {
  let db;

  beforeEach(() => {
    db = new FolderDB();
  });

  // Force the throttled _processNewFolders to run immediately
  function flush() {
    db._processNewFolders.flush();
  }

  function makeFolder(files = {}) {
    return {
      files,
      status: { scanning: false, checking: false, scannedTime: 0 },
    };
  }

  it('adds a folder when updateFiles is called with files', () => {
    db.updateFiles({
      '/a': makeFolder({ '/a/img.jpg': { displayName: '/a/img.jpg' } }),
    });
    assert.ok(db._folders['/a'], 'folder added to _folders');
    assert.strictEqual(db.totalFiles, 1);
  });

  it('emits updateFiles with processed data containing files and status properties', () => {
    const emitted = [];
    db.on('updateFiles', (folders) => emitted.push(folders));

    db.updateFiles({
      '/a': makeFolder({ '/a/img.jpg': { displayName: '/a/img.jpg' } }),
    });

    assert.strictEqual(emitted.length, 1, 'one emission');
    assert.ok(emitted[0]['/a'], 'emitted data contains /a');
    assert.ok(emitted[0]['/a'].files !== undefined, 'emitted folder has files property');
    assert.ok(emitted[0]['/a'].status !== undefined, 'emitted folder has status property');
  });

  it('removes a folder when updateFiles is called with a removal signal ({})', () => {
    db.updateFiles({
      '/a': makeFolder({ '/a/img.jpg': { displayName: '/a/img.jpg' } }),
    });
    assert.ok(db._folders['/a'], '/a exists before removal');
    assert.strictEqual(db.totalFiles, 1);

    db.updateFiles({ '/a': {} });
    flush();

    assert.isUndefined(db._folders['/a'], '/a removed from _folders');
    assert.strictEqual(db.totalFiles, 0, 'totalFiles decremented');
  });

  it('emits well-formed data for a removal signal (files: {}, status: {})', () => {
    db.updateFiles({
      '/a': makeFolder({ '/a/img.jpg': { displayName: '/a/img.jpg' } }),
    });

    const emitted = [];
    db.on('updateFiles', (folders) => emitted.push(folders));

    db.updateFiles({ '/a': {} });
    flush();

    assert.strictEqual(emitted.length, 1, 'one emission for the removal');
    const removalData = emitted[0]['/a'];
    assert.ok(removalData !== undefined, 'removal signal emitted for /a');
    assert.ok(removalData.files !== undefined, 'emitted data has files property (not undefined)');
    assert.deepEqual(removalData.files, {}, 'emitted data has empty files');
    assert.ok(removalData.status !== undefined, 'emitted data has status property (not undefined)');
  });

  it('handles a subfolder rename: removal signal then new folder data', () => {
    db.updateFiles({
      '/a/sub1': makeFolder({ '/a/sub1/img.jpg': { displayName: '/a/sub1/img.jpg' } }),
    });
    assert.ok(db._folders['/a/sub1'], '/a/sub1 exists before rename');

    db.updateFiles({
      '/a/sub1': {},
      '/a/sub2': makeFolder({ '/a/sub2/img.jpg': { displayName: '/a/sub2/img.jpg' } }),
    });
    flush();

    assert.isUndefined(db._folders['/a/sub1'], '/a/sub1 removed after rename');
    assert.ok(db._folders['/a/sub2'], '/a/sub2 added after rename');
    assert.strictEqual(db.totalFiles, 1, 'totalFiles reflects only new folder');
  });
});
