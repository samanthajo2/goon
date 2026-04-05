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
import type { FoldersByPath } from '../../lib/folderinfo';

describe('FolderDB', () => {
  let db: FolderDB;

  beforeEach(() => {
    db = new FolderDB();
  });

  // Force the throttled _processNewFolders to run immediately
  function flush(): void {
    (db as unknown as { _processNewFolders: { flush: () => void } })._processNewFolders.flush();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeFolder(files: Record<string, any> = {}): any {
    return {
      files,
      status: { scanning: false, checking: false, scannedTime: 0 },
    };
  }

  function asUpdateArg(folders: Record<string, unknown>): FoldersByPath {
    return folders as unknown as FoldersByPath;
  }

  it('adds a folder when updateFiles is called with files', () => {
    db.updateFiles(asUpdateArg({
      '/a': makeFolder({ '/a/img.jpg': { displayName: '/a/img.jpg' } }),
    }));
    assert.ok((db as unknown as { _folders: Record<string, unknown> })._folders['/a'], 'folder added to _folders');
    assert.strictEqual(db.totalFiles, 1);
  });

  it('emits updateFiles with processed data containing files and status properties', () => {
    const emitted: unknown[] = [];
    db.on('updateFiles', (folders: unknown) => emitted.push(folders));

    db.updateFiles(asUpdateArg({
      '/a': makeFolder({ '/a/img.jpg': { displayName: '/a/img.jpg' } }),
    }));

    assert.strictEqual(emitted.length, 1, 'one emission');
    const data = emitted[0] as Record<string, { files: unknown; status: unknown }>;
    assert.ok(data['/a'], 'emitted data contains /a');
    assert.ok(data['/a'].files !== undefined, 'emitted folder has files property');
    assert.ok(data['/a'].status !== undefined, 'emitted folder has status property');
  });

  it('removes a folder when updateFiles is called with a removal signal ({})', () => {
    db.updateFiles(asUpdateArg({
      '/a': makeFolder({ '/a/img.jpg': { displayName: '/a/img.jpg' } }),
    }));
    const folders = (db as unknown as { _folders: Record<string, unknown> })._folders;
    assert.ok(folders['/a'], '/a exists before removal');
    assert.strictEqual(db.totalFiles, 1);

    db.updateFiles(asUpdateArg({ '/a': {} }));
    flush();

    assert.isUndefined(folders['/a'], '/a removed from _folders');
    assert.strictEqual(db.totalFiles, 0, 'totalFiles decremented');
  });

  it('emits well-formed data for a removal signal (files: {}, status: {})', () => {
    db.updateFiles(asUpdateArg({
      '/a': makeFolder({ '/a/img.jpg': { displayName: '/a/img.jpg' } }),
    }));

    const emitted: unknown[] = [];
    db.on('updateFiles', (folders: unknown) => emitted.push(folders));

    db.updateFiles(asUpdateArg({ '/a': {} }));
    flush();

    assert.strictEqual(emitted.length, 1, 'one emission for the removal');
    const data = emitted[0] as Record<string, { files: unknown; status: unknown }>;
    const removalData = data['/a'];
    assert.ok(removalData !== undefined, 'removal signal emitted for /a');
    assert.ok(removalData.files !== undefined, 'emitted data has files property (not undefined)');
    assert.deepEqual(removalData.files, {}, 'emitted data has empty files');
    assert.ok(removalData.status !== undefined, 'emitted data has status property (not undefined)');
  });

  it('handles a subfolder rename: removal signal then new folder data', () => {
    db.updateFiles(asUpdateArg({
      '/a/sub1': makeFolder({ '/a/sub1/img.jpg': { displayName: '/a/sub1/img.jpg' } }),
    }));
    const folders = (db as unknown as { _folders: Record<string, unknown> })._folders;
    assert.ok(folders['/a/sub1'], '/a/sub1 exists before rename');

    db.updateFiles(asUpdateArg({
      '/a/sub1': {},
      '/a/sub2': makeFolder({ '/a/sub2/img.jpg': { displayName: '/a/sub2/img.jpg' } }),
    }));
    flush();

    assert.isUndefined(folders['/a/sub1'], '/a/sub1 removed after rename');
    assert.ok(folders['/a/sub2'], '/a/sub2 added after rename');
    assert.strictEqual(db.totalFiles, 1, 'totalFiles reflects only new folder');
  });
});
