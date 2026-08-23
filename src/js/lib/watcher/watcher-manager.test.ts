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

 
 

import path from 'node:path';
import nodeFs from 'node:fs';
import os from 'node:os';
import { describe, it, beforeEach, afterEach } from '../test/mocha.js';
import { assert } from 'chai';
import WatcherManager, { FolderWatcher } from './watcher-manager.js';
import TestFS from '../test/test-fs.js';
import { emitSpy } from '../test/test-utils.js';

// TestFS dynamically proxies the underlying fs methods at construction time.
type TestFSWithMethods = TestFS & {
  writeFileSync: (path: string, data: string) => void;
  unlinkSync: (path: string) => void;
  mkdirSync: (path: string) => void;
  rmdirSync: (path: string) => void;
};

describe('WatcherManager', function () {
  this.timeout(25000);
  let testFS: TestFSWithMethods;
  let watcherManager: WatcherManager;
  let watchers: FolderWatcher[] = [];

  function makeWatcher(filepath: string): FolderWatcher {
    const watcher = watcherManager.watch(filepath)!;
    watchers.push(watcher);
    return watcher;
  }

  beforeEach(() => {
    testFS = new TestFS() as TestFSWithMethods;
    watcherManager = new WatcherManager();
  });

  afterEach(() => {
    watchers.forEach((watcher) => {
      watcher.close();
    });
    watchers = [];
    watcherManager.close();
    testFS.close();
  });

  it('notices changes', async () => {
    const fs = testFS;
    const watcher = makeWatcher(testFS.baseFilename);

    const start = emitSpy(); // 'start:');
    const create = emitSpy(); // 'create:');
    const change = emitSpy(); // 'change:');
    const remove = emitSpy(); // 'remove:');
    watcher.on('start', start);
    watcher.on('create', create);
    watcher.on('change', change);
    watcher.on('remove', remove);

    await start.wait();

    const testpath = path.join(fs.baseFilename, 'test.txt');
    fs.writeFileSync(testpath, 'foo');

    // this is not a good test since unless we give it more time
    // we have no idea if extra events come through?
    await create.wait();

    assert.strictEqual(create.spy.callCount, 1, 'file created');
    assert.strictEqual(change.spy.callCount, 0, 'file not changed');
    assert.strictEqual(remove.spy.callCount, 0, 'file not deleted');

    fs.writeFileSync(testpath, 'bar');

    await change.wait();

    assert.strictEqual(create.spy.callCount, 1, 'file created');
    assert.strictEqual(change.spy.callCount, 1, 'file changed');
    assert.strictEqual(remove.spy.callCount, 0, 'file not deleted');

    fs.unlinkSync(testpath);

    await remove.wait();

    assert.strictEqual(create.spy.callCount, 1, 'file created');
    assert.strictEqual(change.spy.callCount, 1, 'file changed');
    assert.strictEqual(remove.spy.callCount, 1, 'file deleted');
  });

  it('notices subfolder creation but not subfolder activity', async () => {
    const fs = testFS;
    const watcher = makeWatcher(testFS.baseFilename);

    const start = emitSpy(); // 'start:');
    const create = emitSpy(); // 'create:');
    const change = emitSpy(); // 'change:');
    const remove = emitSpy(); // 'remove:');
    watcher.on('start', start);
    watcher.on('create', create);
    watcher.on('change', change);
    watcher.on('remove', remove);

    await start.wait();

    const parentDirname = path.join(fs.baseFilename, 'test');
    const dirname = path.join(parentDirname, 'subtest');
    fs.mkdirSync(parentDirname);

    await create.wait();

    assert.isAtLeast(create.spy.callCount, 1, 'file created subfolder');
    assert.strictEqual(change.spy.callCount, 0, 'file not changed');
    assert.strictEqual(remove.spy.callCount, 0, 'file not deleted');
    const expectedCreateCountAfterSubCreate = create.spy.callCount;

    const parentWatcher = makeWatcher(parentDirname);
    const parentStart = emitSpy(); // 'start:');
    const parentCreate = emitSpy(); // 'create:');
    const parentChange = emitSpy(); // 'change:');
    const parentRemove = emitSpy(); // 'remove:');
    parentWatcher.on('start', parentStart);
    parentWatcher.on('create', parentCreate);
    parentWatcher.on('change', parentChange);
    parentWatcher.on('remove', parentRemove);

    await parentStart.wait();

    fs.mkdirSync(dirname);
    await parentCreate.wait();

    assert.isAtLeast(create.spy.callCount, expectedCreateCountAfterSubCreate, 'file created subfolder2');
    assert.strictEqual(change.spy.callCount, 0, 'file not changed2');
    assert.strictEqual(remove.spy.callCount, 0, 'file not deleted2');
    const expectedCreateCountAfterFileCreate = create.spy.callCount;

    const subWatcher = makeWatcher(dirname);
    const subStart = emitSpy(); // 'start:');
    const subCreate = emitSpy(); // 'create:');
    const subChange = emitSpy(); // 'change:');
    const subRemove = emitSpy(); // 'remove:');
    subWatcher.on('start', subStart);
    subWatcher.on('create', subCreate);
    subWatcher.on('change', subChange);
    subWatcher.on('remove', subRemove);

    await subStart.wait();

    const testpath = path.join(dirname, 'test.txt');
    fs.writeFileSync(testpath, 'foo');

    await subCreate.wait();

    assert.isAtLeast(create.spy.callCount, expectedCreateCountAfterFileCreate, '1 created');
    assert.strictEqual(change.spy.callCount, 0, 'file not changed');
    assert.strictEqual(remove.spy.callCount, 0, 'file not deleted');
    const expectedCreateCountAfterFileUpdate = create.spy.callCount;

    fs.writeFileSync(testpath, 'bar');

    await subChange.wait();

    assert.strictEqual(create.spy.callCount, expectedCreateCountAfterFileUpdate, '1 file created');
    assert.strictEqual(change.spy.callCount, 0, 'file not changed after change');
    assert.strictEqual(remove.spy.callCount, 0, 'file not deleted after change');

    fs.unlinkSync(testpath);

    await subRemove.wait();

    assert.strictEqual(create.spy.callCount, expectedCreateCountAfterFileUpdate, '1 file created');
    assert.isAtLeast(change.spy.callCount, 0, 'file not changed after delete');
    assert.strictEqual(remove.spy.callCount, 0, 'file not deleted after delete');

    fs.rmdirSync(dirname);
    fs.rmdirSync(parentDirname);

    await remove.wait();

    assert.strictEqual(create.spy.callCount, expectedCreateCountAfterFileUpdate, '1 files created');
    assert.isAtLeast(change.spy.callCount, 0, 'no file changed after rmdir');
    assert.strictEqual(remove.spy.callCount, 1, '1 file deleted');
  });

  it('watches a symlinked subfolder whose target is outside the root', async () => {
    // Watch the root first, so the symlink would otherwise be collapsed under it and
    // served by the root's recursive watcher — which @parcel/watcher won't recurse
    // into. Watching both root and symlink is what reproduces the original bug.
    const rootWatcher = makeWatcher(testFS.baseFilename);
    const rootStart = emitSpy();
    rootWatcher.on('start', rootStart);
    await rootStart.wait();

    // A target directory OUTSIDE the watched tree, reached via a symlink inside it.
    const target = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'goon-symlink-target-'));
    const linkPath = path.join(testFS.baseFilename, 'link');
    nodeFs.symlinkSync(target, linkPath, 'dir');

    try {
      const linkWatcher = makeWatcher(linkPath);
      const linkStart = emitSpy();
      const linkCreate = emitSpy();
      linkWatcher.on('start', linkStart);
      linkWatcher.on('create', linkCreate);
      await linkStart.wait();

      // A change inside the *target* must surface on the symlinked folder's watcher.
      nodeFs.writeFileSync(path.join(target, 'foo.txt'), 'hi');
      await linkCreate.wait();
      assert.isAtLeast(linkCreate.spy.callCount, 1, 'change under symlink target seen');
    } finally {
      // The symlink is untracked by TestFS; unlink it (unlinkSync removes the link
      // itself, not its target) so the base dir is empty for cleanup.
      try { nodeFs.unlinkSync(linkPath); } catch { /* already gone */ }
      nodeFs.rmSync(target, { recursive: true, force: true });
    }
  });
});
