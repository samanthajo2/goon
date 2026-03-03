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
import path from 'node:path';
import sinon from 'sinon';
import { describe, it } from './test/mocha';
import { assert } from 'chai';
import SimpleFolderWatcher from './simple-folder-watcher';
import wait from './wait';

const TEST_DIR = '/testdir';

function makeStat(size, mtimeMs, isDirectory = false) {
  return {
    size,
    mtimeMs,
    mtime: new Date(mtimeMs),  // Date object, as real fs.stat returns
    isDirectory: () => isDirectory,
  };
}

function setupWatcher(options = {}) {
  const mockWatcherEE = new EventEmitter();
  mockWatcherEE.close = sinon.spy();

  const watcherFactory = sinon.stub().returns(mockWatcherEE);

  const readdirCallbacks = [];
  const statCallbacks = {};

  const mockFs = {
    readdir: sinon.stub().callsFake((dirPath, cb) => {
      readdirCallbacks.push(cb);
    }),
    stat: sinon.stub().callsFake((filePath, cb) => {
      const basename = path.basename(filePath);
      if (!statCallbacks[basename]) {
        statCallbacks[basename] = [];
      }
      statCallbacks[basename].push(cb);
    }),
  };

  const watcher = new SimpleFolderWatcher(TEST_DIR, {
    watcherFactory,
    fs: mockFs,
    ...options,
  });

  // Helpers to drive the async callbacks
  function resolveReaddir(fileNames) {
    const cb = readdirCallbacks.shift();
    assert.ok(cb, 'expected a readdir callback');
    cb(null, fileNames);
  }

  function resolveStat(basename, stat) {
    const cbs = statCallbacks[basename];
    assert.ok(cbs && cbs.length > 0, `expected a stat callback for ${basename}`);
    const cb = cbs.shift();
    cb(null, stat);
  }

  function rejectStat(basename, err) {
    const cbs = statCallbacks[basename];
    assert.ok(cbs && cbs.length > 0, `expected a stat callback for ${basename}`);
    const cb = cbs.shift();
    cb(err || new Error('ENOENT'));
  }

  return {
    watcher,
    mockWatcherEE,
    watcherFactory,
    mockFs,
    resolveReaddir,
    resolveStat,
    rejectStat,
  };
}

describe('SimpleFolderWatcher', () => {
  it('emits add with full path on initial scan', async () => {
    const { watcher, resolveReaddir, resolveStat } = setupWatcher();

    const add = sinon.spy();
    const end = sinon.spy();
    watcher.on('add', add);
    watcher.on('end', end);

    // Let nextTick run so _start and _scan are called
    await wait();

    resolveReaddir(['foo.jpg']);
    resolveReaddir;  // readdir for foo.jpg? no - stat is called
    resolveStat('foo.jpg', makeStat(1000, 1700000000000));

    await wait();

    assert.strictEqual(add.callCount, 1, 'add fired once');
    assert.strictEqual(add.firstCall.args[0], path.join(TEST_DIR, 'foo.jpg'), 'full path emitted');
  });

  it('emits remove with full path when file disappears on refresh scan (Bug 1)', async () => {
    const { watcher, resolveReaddir, resolveStat } = setupWatcher();

    const add = sinon.spy();
    const remove = sinon.spy();
    const end = sinon.spy();
    watcher.on('add', add);
    watcher.on('remove', remove);
    watcher.on('end', end);

    await wait();

    // Initial scan: foo.jpg exists
    resolveReaddir(['foo.jpg']);
    resolveStat('foo.jpg', makeStat(1000, 1700000000000));

    await wait();

    assert.strictEqual(add.callCount, 1, 'file was added');
    assert.strictEqual(remove.callCount, 0, 'nothing removed yet');

    // Refresh scan: foo.jpg is gone
    watcher.refresh();
    await wait();

    resolveReaddir([]);  // no files

    await wait();

    assert.strictEqual(remove.callCount, 1, 'remove fired once');
    // Bug 1 fix: should be full path, not just basename
    assert.strictEqual(
      remove.firstCall.args[0],
      path.join(TEST_DIR, 'foo.jpg'),
      'remove emits full path, not basename'
    );
  });

  it('does not re-emit remove for the same deleted file on subsequent scans (Bug 1)', async () => {
    const { watcher, resolveReaddir, resolveStat } = setupWatcher();

    const remove = sinon.spy();
    watcher.on('remove', remove);

    await wait();

    // Initial scan: foo.jpg exists
    resolveReaddir(['foo.jpg']);
    resolveStat('foo.jpg', makeStat(1000, 1700000000000));
    await wait();

    // First refresh: foo.jpg gone
    watcher.refresh();
    await wait();
    resolveReaddir([]);
    await wait();

    assert.strictEqual(remove.callCount, 1, 'removed once');

    // Second refresh: still empty
    watcher.refresh();
    await wait();
    resolveReaddir([]);
    await wait();

    assert.strictEqual(remove.callCount, 1, 'not removed again - entry was cleaned from _entries');
  });

  it('does not emit change when file size and mtime are unchanged (Bug 2)', async () => {
    const stat = makeStat(1000, 1700000000000);
    const { watcher, resolveReaddir, resolveStat } = setupWatcher();

    const add = sinon.spy();
    const change = sinon.spy();
    watcher.on('add', add);
    watcher.on('change', change);

    await wait();

    // Initial scan
    resolveReaddir(['foo.jpg']);
    resolveStat('foo.jpg', stat);
    await wait();

    assert.strictEqual(add.callCount, 1, 'added');
    assert.strictEqual(change.callCount, 0, 'no change yet');

    // Refresh: same file, same size, same mtimeMs but NEW Date object (simulating real fs.stat)
    watcher.refresh();
    await wait();
    resolveReaddir(['foo.jpg']);
    // Same values but a brand-new stat object (different Date reference)
    resolveStat('foo.jpg', makeStat(1000, 1700000000000));
    await wait();

    assert.strictEqual(add.callCount, 1, 'not re-added');
    // Bug 2 fix: should NOT fire change when only the Date reference differs but value is same
    assert.strictEqual(change.callCount, 0, 'no spurious change when mtime value is unchanged');
  });

  it('emits change when mtime changes (Bug 2)', async () => {
    const { watcher, resolveReaddir, resolveStat } = setupWatcher();

    const add = sinon.spy();
    const change = sinon.spy();
    watcher.on('add', add);
    watcher.on('change', change);

    await wait();

    // Initial scan
    resolveReaddir(['foo.jpg']);
    resolveStat('foo.jpg', makeStat(1000, 1700000000000));
    await wait();

    assert.strictEqual(add.callCount, 1, 'added');

    // Refresh: same size, different mtime
    watcher.refresh();
    await wait();
    resolveReaddir(['foo.jpg']);
    resolveStat('foo.jpg', makeStat(1000, 1700000001000));  // mtime advanced 1 second
    await wait();

    assert.strictEqual(change.callCount, 1, 'change fired when mtime changed');
  });

  it('emits change when size changes', async () => {
    const { watcher, resolveReaddir, resolveStat } = setupWatcher();

    const add = sinon.spy();
    const change = sinon.spy();
    watcher.on('add', add);
    watcher.on('change', change);

    await wait();

    resolveReaddir(['foo.jpg']);
    resolveStat('foo.jpg', makeStat(1000, 1700000000000));
    await wait();

    watcher.refresh();
    await wait();
    resolveReaddir(['foo.jpg']);
    resolveStat('foo.jpg', makeStat(2000, 1700000000000));  // size changed
    await wait();

    assert.strictEqual(change.callCount, 1, 'change fired when size changed');
  });

  it('emits create event when watcher fires create for a new file', async () => {
    const { watcher, mockWatcherEE, resolveReaddir, resolveStat } = setupWatcher();

    const add = sinon.spy();
    const create = sinon.spy();
    watcher.on('add', add);
    watcher.on('create', create);

    await wait();

    // Initial scan: empty dir
    resolveReaddir([]);
    await wait();

    // OS watcher fires 'create' for a new file
    mockWatcherEE.emit('create', path.join(TEST_DIR, 'new.jpg'));
    resolveStat('new.jpg', makeStat(500, 1700000000000));
    await wait();

    assert.strictEqual(create.callCount, 1, 'create event fired');
    assert.strictEqual(create.firstCall.args[0], path.join(TEST_DIR, 'new.jpg'), 'full path');
  });

  it('emits remove when stat fails after watcher fires remove', async () => {
    const { watcher, mockWatcherEE, resolveReaddir, resolveStat, rejectStat } = setupWatcher();

    const add = sinon.spy();
    const remove = sinon.spy();
    watcher.on('add', add);
    watcher.on('remove', remove);

    await wait();

    // Initial scan: file exists
    resolveReaddir(['bar.jpg']);
    resolveStat('bar.jpg', makeStat(999, 1700000000000));
    await wait();

    assert.strictEqual(add.callCount, 1, 'added');

    // OS watcher fires 'remove', and stat confirms it's gone
    mockWatcherEE.emit('remove', path.join(TEST_DIR, 'bar.jpg'));
    rejectStat('bar.jpg');
    await wait();

    assert.strictEqual(remove.callCount, 1, 'remove fired');
    assert.strictEqual(remove.firstCall.args[0], path.join(TEST_DIR, 'bar.jpg'), 'full path');
  });

  it('emits end after initial scan completes', async () => {
    const { watcher, resolveReaddir, resolveStat } = setupWatcher();

    const end = sinon.spy();
    watcher.on('end', end);

    await wait();

    resolveReaddir(['a.jpg', 'b.jpg']);
    resolveStat('a.jpg', makeStat(100, 1700000000000));
    resolveStat('b.jpg', makeStat(200, 1700000000001));
    await wait();

    assert.strictEqual(end.callCount, 1, 'end fired once after scan');
  });
});
