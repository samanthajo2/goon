/*
Copyright 2024 SamanthaJo

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import EventEmitter from 'events';
import sinon from 'sinon';
import {assert} from 'chai';
import NativeFolder from './native-folder';
import wait from './../../lib/wait';

describe('NativeFolder', () => {
  function createFolderData(baseFilename, files) {
    return {
      files: files || {},
      baseFilename: baseFilename,
      deleteData: sinon.spy(),
      addFiles: function addFiles(files) {
        Object.assign(this.files, files);
      },
      removeFiles: function removeFiles(filenames) {
        for (const filename of filenames) {
          delete this.files[filename];
        }
      },
      setScannedTime() {
      },
    };
  }

  function setupNativeFolder(files, folders, archives) {
    // just emits 'files' with Object.<string, FileInfo>
    const watcher = new EventEmitter();
    watcher.close = sinon.spy();

    const folderData = createFolderData(
      'root',
      {...files, ...folders, ...archives},
    );
    const thumbnailPageMaker = sinon.stub();

    const folder = new NativeFolder('foo', {
      watcher: watcher,
      thumbnailPageMakerFn: thumbnailPageMaker,
      folderData: folderData,
    });

    const updateFiles = sinon.spy();
    folder.on('updateFiles', updateFiles);
    const updateFolders = sinon.spy();
    folder.on('updateFolders', updateFolders);
    const updateArchives = sinon.spy();
    folder.on('updateArchives', updateArchives);

    return {
      folder,
      watcher,
      thumbnailPageMaker,
      folderData,
      updateFiles,
      updateFolders,
      updateArchives,
    };
  }

  it('inits', async () => {
    const testFiles = {
      'test.png': { type: 'image/png', },
    };
    const testFolders = {
      'subFolder': {  isDirectory: true, },
    };
    const testArchives = {
      'test.zip': {},
    };
    const nf = setupNativeFolder(testFiles, testFolders, testArchives);

    await wait();

    assert.strictEqual(nf.updateFiles.callCount, 1);
    assert.deepEqual(nf.updateFiles.lastCall.args[1].files, testFiles, 'one file');
    assert.strictEqual(nf.updateFolders.callCount, 1);
    assert.deepEqual(nf.updateFolders.lastCall.args[1], testFolders, 'one folder');
    assert.strictEqual(nf.updateArchives.callCount, 1);
    assert.deepEqual(nf.updateArchives.lastCall.args[1], testArchives, 'one archive');
    assert.deepEqual(nf.updateArchives.lastCall.args[2], [], 'no archives need updating');
    assert.strictEqual(nf.thumbnailPageMaker.callCount, 0, 'no thumbnails created');

    assert.strictEqual(nf.folderData.deleteData.callCount, 0);
    nf.folder.deleteData();
    assert.strictEqual(nf.folderData.deleteData.callCount, 1);
  });

  it('makes thumbnails and updates', async () => {
    const oldFiles = {
      'test.png': { type: 'image/png', },
    };
    const nf = setupNativeFolder(oldFiles, {}, {});

    await wait();

    assert.strictEqual(nf.updateFiles.callCount, 1);
    const thumbnailFiles = {
      'one.jpg': { type: 'image/jpeg', thumbnail: { url: 'foo1', }, },
      'two.png': { type: 'image/png', thumbnail: { url: 'foo2', }, },
    };
    nf.thumbnailPageMaker.resolves(thumbnailFiles);
    nf.watcher.emit('files', {
      'one.jpg': { },
      'two.png': { },
      'three.txt': { },
    });
    const newFiles = {
      'one.jpg': {  },
      'two.png': {  },
    };

    await wait();
    await wait();
    await wait();

    assert.strictEqual(nf.thumbnailPageMaker.callCount, 1, 'thumbnails created');
    assert.deepEqual(nf.thumbnailPageMaker.lastCall.args[0], oldFiles, 'old files');
    assert.deepEqual(nf.thumbnailPageMaker.lastCall.args[1], newFiles, 'new files');
    assert.isAtLeast(nf.updateFiles.callCount, 3);
    assert.deepEqual(nf.updateFiles.lastCall.args[1].files, thumbnailFiles, 'thumbnail files');
  });
});
