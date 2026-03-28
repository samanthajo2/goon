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
