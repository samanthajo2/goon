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

import EventEmitter from 'node:events';
import sinon from 'sinon';
import { describe, it, beforeEach } from '../../lib/test/mocha';
import { assert } from 'chai';
import ThumbnailManager from './thumbnail-manager';

describe('ThumbnailManager', () => {
  let manager;
  let mockFolders;
  let mockArchives;

  function createMockNativeFolder(filename) {
    const folder = new EventEmitter();
    folder.filename = filename;
    folder.close = sinon.spy();
    folder.deleteData = sinon.stub().returns({ folders: [], archives: [] });
    folder.getData = sinon.stub().returns({ files: {}, status: {} });
    folder.refresh = sinon.spy();
    folder.getSeparateFilenames = sinon.stub().returns({ folders: [], archives: [] });
    return folder;
  }

  function createMockArchiveFolder(filename) {
    const folder = new EventEmitter();
    folder.filename = filename;
    folder.close = sinon.spy();
    folder.deleteData = sinon.stub().returns({ folders: [], archives: [] });
    folder.update = sinon.spy();
    return folder;
  }

  function createMockFs() {
    return {
      existsSync: sinon.stub().returns(false),
      readdir: sinon.stub().callsArgWith(1, null, []),
      readFileAsStringSync: sinon.stub().returns('{}'),
      unlinkSync: sinon.stub(),
      writeFileSync: sinon.stub(),
      statSync: sinon.stub().returns({ mtimeMs: 0 }),
      stat: sinon.stub(),
    };
  }

  beforeEach(() => {
    mockFolders = {};
    mockArchives = {};

    const nativeFolderFactory = (filename) => {
      const mock = createMockNativeFolder(filename);
      mockFolders[filename] = mock;
      return mock;
    };

    const archiveFolderFactory = (filename) => {
      const mock = createMockArchiveFolder(filename);
      mockArchives[filename] = mock;
      return mock;
    };

    const mockWatcher = new EventEmitter();
    mockWatcher.close = sinon.spy();

    manager = new ThumbnailManager({
      dataDir: '/data',
      fs: createMockFs(),
      watcherFactory: sinon.stub().returns(mockWatcher),
      nativeFolderFactory,
      archiveFolderFactory,
      thumbnailPageMakerManager: {},
    });
  });

  it('adds a root folder when setFolders is called', () => {
    manager.setFolders(['/a']);
    assert.ok(manager._folders['/a'], 'folder added to _folders');
    assert.ok(manager._rootFolder.folders['/a'], 'folder added to _rootFolder.folders');
  });

  it('adds a sub-folder when a native folder emits updateFolders', () => {
    manager.setFolders(['/a']);
    mockFolders['/a'].emit('updateFolders', '/a', { '/a/b': { isDirectory: true } });
    assert.ok(manager._folders['/a/b'], 'sub-folder added to _folders');
    assert.ok(manager._folders['/a'].folders['/a/b'], 'sub-folder tracked in parent folders map');
  });

  it('emits updateFiles when a native folder emits updateFiles', () => {
    manager.setFolders(['/a']);
    const updateFilesSpy = sinon.spy();
    manager.on('updateFiles', updateFilesSpy);

    mockFolders['/a'].emit('updateFiles', '/a', {
      files: { '/a/foo.jpg': { type: 'image/jpeg' } },
      status: {},
    });

    assert.ok(updateFilesSpy.called, 'manager emitted updateFiles');
    const emitted = updateFilesSpy.lastCall.args[0];
    assert.ok(emitted['/a'], 'emitted data contains folder /a');
  });

  it('removes a root folder when setFolders is called without it', () => {
    manager.setFolders(['/a']);
    const updateFilesSpy = sinon.spy();
    manager.on('updateFiles', updateFilesSpy);

    manager.setFolders([]);

    assert.isUndefined(manager._folders['/a'], 'folder removed from _folders');
    assert.isUndefined(manager._rootFolder.folders['/a'], 'folder removed from _rootFolder.folders');
    assert.ok(mockFolders['/a'].close.called, 'native folder was closed');
    assert.ok(updateFilesSpy.called, 'updateFiles emitted for removed folder');
    const emitted = updateFilesSpy.lastCall.args[0];
    assert.deepEqual(emitted['/a'], {}, 'emitted empty data for removed folder');
  });

  it('removes a sub-folder when updateFolders fires without it', () => {
    manager.setFolders(['/a']);
    mockFolders['/a'].emit('updateFolders', '/a', { '/a/b': { isDirectory: true } });

    const updateFilesSpy = sinon.spy();
    manager.on('updateFiles', updateFilesSpy);

    mockFolders['/a'].emit('updateFolders', '/a', {});

    assert.isUndefined(manager._folders['/a/b'], 'sub-folder removed from _folders');
    assert.isUndefined(manager._folders['/a'].folders['/a/b'], 'sub-folder removed from parent folders map');
    assert.ok(mockFolders['/a/b'].close.called, 'sub-folder native folder was closed');
    assert.ok(updateFilesSpy.called, 'updateFiles emitted for removed sub-folder');
    const emitted = updateFilesSpy.lastCall.args[0];
    assert.deepEqual(emitted['/a/b'], {}, 'emitted empty data for removed sub-folder');
  });

  it('removes deeply nested sub-folders even when getSeparateFilenames returns empty', () => {
    manager.setFolders(['/a']);
    mockFolders['/a'].emit('updateFolders', '/a', { '/a/b': { isDirectory: true } });
    mockFolders['/a/b'].emit('updateFolders', '/a/b', { '/a/b/c': { isDirectory: true } });

    // Simulate the bug: /a/b's NativeFolder getSeparateFilenames returns empty
    // because the watcher hasn't fired yet so _folderData is not yet populated
    mockFolders['/a/b'].getSeparateFilenames.returns({ folders: [], archives: [] });

    assert.ok(manager._folders['/a'], '/a exists before removal');
    assert.ok(manager._folders['/a/b'], '/a/b exists before removal');
    assert.ok(manager._folders['/a/b/c'], '/a/b/c exists before removal');

    // /a reports that /a/b no longer exists
    mockFolders['/a'].emit('updateFolders', '/a', {});

    assert.isUndefined(manager._folders['/a/b'], '/a/b removed from _folders');
    assert.isUndefined(manager._folders['/a/b/c'], '/a/b/c removed from _folders even though getSeparateFilenames was empty');
    assert.ok(mockFolders['/a/b'].close.called, '/a/b native folder closed');
    assert.ok(mockFolders['/a/b/c'].close.called, '/a/b/c native folder closed');
  });

  it('handles subfolder rename by removing old and adding new', () => {
    manager.setFolders(['/a']);
    mockFolders['/a'].emit('updateFolders', '/a', { '/a/sub1': { isDirectory: true } });

    assert.ok(manager._folders['/a/sub1'], '/a/sub1 exists before rename');

    const updateFilesSpy = sinon.spy();
    manager.on('updateFiles', updateFilesSpy);

    // Simulate rename: /a now reports /a/sub2 instead of /a/sub1
    mockFolders['/a'].emit('updateFolders', '/a', { '/a/sub2': { isDirectory: true } });

    assert.isUndefined(manager._folders['/a/sub1'], '/a/sub1 removed after rename');
    assert.ok(mockFolders['/a/sub1'].close.called, '/a/sub1 native folder was closed');
    assert.ok(manager._folders['/a/sub2'], '/a/sub2 added after rename');

    const removedCall = updateFilesSpy.getCalls().find(call => '/a/sub1' in call.args[0]);
    assert.ok(removedCall, 'updateFiles emitted signaling /a/sub1 removal');
    assert.deepEqual(removedCall.args[0]['/a/sub1'], {}, 'empty data emitted for removed /a/sub1');
  });

  it('does not re-emit stale file data for a folder after it is removed', () => {
    manager.setFolders(['/a']);
    mockFolders['/a'].emit('updateFolders', '/a', { '/a/sub1': { isDirectory: true } });

    // Two updateFiles calls for /a/sub1 — the first fires the throttle leading edge,
    // the second gets queued as the trailing edge (deferred by 500ms)
    mockFolders['/a/sub1'].emit('updateFiles', '/a/sub1', {
      files: { '/a/sub1/img.jpg': { type: 'image/jpeg' } },
      status: {},
    });
    mockFolders['/a/sub1'].emit('updateFiles', '/a/sub1', {
      files: { '/a/sub1/img.jpg': { type: 'image/jpeg' } },
      status: {},
    });

    // Remove the folder (simulating a rename)
    mockFolders['/a'].emit('updateFolders', '/a', {});

    const updateFilesSpy = sinon.spy();
    manager.on('updateFiles', updateFilesSpy);

    // Force the throttled trailing emission — this should NOT re-emit stale data for /a/sub1
    manager._emitUpdateFiles.flush();

    const staleEmit = updateFilesSpy.getCalls().find((call) => {
      const data = call.args[0]['/a/sub1'];
      return data && data.files && Object.keys(data.files).length > 0;
    });
    assert.isUndefined(staleEmit, 'no stale file data emitted for removed /a/sub1');
  });

  it('does not emit stale data for a folder renamed away then back within the throttle window', () => {
    manager.setFolders(['/a']);
    mockFolders['/a'].emit('updateFolders', '/a', { '/a/sub1': { isDirectory: true } });

    // Two updateFiles calls so the second sits in the pending throttle queue
    mockFolders['/a/sub1'].emit('updateFiles', '/a/sub1', {
      files: { '/a/sub1/img.jpg': { type: 'image/jpeg' } },
      status: {},
    });
    mockFolders['/a/sub1'].emit('updateFiles', '/a/sub1', {
      files: { '/a/sub1/img.jpg': { type: 'image/jpeg' } },
      status: {},
    });

    // Rename: sub1 → sub2
    mockFolders['/a'].emit('updateFolders', '/a', { '/a/sub2': { isDirectory: true } });
    assert.isUndefined(manager._folders['/a/sub1'], '/a/sub1 removed after rename');
    assert.ok(manager._folders['/a/sub2'], '/a/sub2 added after rename');

    // sub2 also gets pending updates
    mockFolders['/a/sub2'].emit('updateFiles', '/a/sub2', {
      files: { '/a/sub2/img.jpg': { type: 'image/jpeg' } },
      status: {},
    });
    mockFolders['/a/sub2'].emit('updateFiles', '/a/sub2', {
      files: { '/a/sub2/img.jpg': { type: 'image/jpeg' } },
      status: {},
    });

    // Rename back: sub2 → sub1
    mockFolders['/a'].emit('updateFolders', '/a', { '/a/sub1': { isDirectory: true } });
    assert.isUndefined(manager._folders['/a/sub2'], '/a/sub2 removed after rename-back');
    assert.ok(manager._folders['/a/sub1'], '/a/sub1 re-added after rename-back');

    const updateFilesSpy = sinon.spy();
    manager.on('updateFiles', updateFilesSpy);

    // Flush the throttle — neither sub1 nor sub2 should have stale file data
    manager._emitUpdateFiles.flush();

    const staleEmit = updateFilesSpy.getCalls().find((call) => {
      const sub1Data = call.args[0]['/a/sub1'];
      const sub2Data = call.args[0]['/a/sub2'];
      const sub1HasFiles = sub1Data && sub1Data.files && Object.keys(sub1Data.files).length > 0;
      const sub2HasFiles = sub2Data && sub2Data.files && Object.keys(sub2Data.files).length > 0;
      return sub1HasFiles || sub2HasFiles;
    });
    assert.isUndefined(staleEmit, 'no stale file data from either intermediate name');
  });

  it('removes archives when parent folder is removed', () => {
    manager.setFolders(['/a']);
    mockFolders['/a'].emit('updateArchives', '/a', { '/a/b.zip': {} }, []);

    assert.ok(manager._archives['/a/b.zip'], 'archive is tracked');

    const updateFilesSpy = sinon.spy();
    manager.on('updateFiles', updateFilesSpy);

    manager.setFolders([]);

    assert.isUndefined(manager._archives['/a/b.zip'], 'archive removed from _archives');
    assert.ok(mockArchives['/a/b.zip'].close.called, 'archive folder closed');
    const calls = updateFilesSpy.getCalls();
    const removedArchiveCall = calls.find(call => call.args[0]['/a/b.zip'] !== undefined);
    assert.ok(removedArchiveCall, 'updateFiles emitted for removed archive');
    assert.deepEqual(removedArchiveCall.args[0]['/a/b.zip'], {}, 'emitted empty data for removed archive');
  });
});
