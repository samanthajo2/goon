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

type FakeStat = {
  size: number;
  mtimeMs: number;
  mtime: Date;
  isDirectory: () => boolean;
};

function makeStat(size: number, mtimeMs: number, isDirectory = false): FakeStat {
  return {
    size,
    mtimeMs,
    mtime: new Date(mtimeMs),  // Date object, as real fs.stat returns
    isDirectory: () => isDirectory,
  };
}

const DIR_STAT_DEFAULT_MTIME = 1_600_000_000_000;

type ReadDirCb = (err: Error | null, files: string[]) => void;
type StatCb = (err: Error | null, stat: FakeStat) => void;

type SetupOptions = {
  dirStat?: boolean;
  cachedDirMtime?: number;
  initialEntries?: Map<string, { size: number; mtimeMs: number; isDirectory: boolean }>;
  onDirMtime?: (mtime: number) => void;
};

function setupWatcher(options: SetupOptions = {}) {
  const mockWatcherEE = new EventEmitter() as EventEmitter & { close: sinon.SinonSpy };
  mockWatcherEE.close = sinon.spy();

  const watcherFactory = sinon.stub().returns(mockWatcherEE);

  const readdirCallbacks: ReadDirCb[] = [];
  const statCallbacks: Record<string, StatCb[]> = {};
  // Pending callbacks for the directory itself (path === TEST_DIR)
  const dirStatCallbacks: StatCb[] = [];

  const mockFs = {
    readdir: sinon.stub().callsFake((_dirPath: string, cb: ReadDirCb) => {
      readdirCallbacks.push(cb);
    }),
    stat: sinon.stub().callsFake((filePath: string, cb: StatCb) => {
      if (filePath === TEST_DIR) {
        // If no dirStat option provided, auto-resolve synchronously with a
        // default mtime so existing tests don't need to drive it manually.
        // cachedDirMtime is undefined in those tests so the fast path is never taken.
        if (options.dirStat === undefined) {
          cb(null, makeStat(0, DIR_STAT_DEFAULT_MTIME, true));
        } else {
          dirStatCallbacks.push(cb);
        }
        return;
      }
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
  function resolveReaddir(fileNames: string[]): void {
    const cb = readdirCallbacks.shift();
    assert.ok(cb, 'expected a readdir callback');
    cb!(null, fileNames);
  }

  function resolveDirStat(stat: FakeStat): void {
    const cb = dirStatCallbacks.shift();
    assert.ok(cb, 'expected a dir stat callback');
    cb!(null, stat);
  }

  function rejectDirStat(err?: Error): void {
    const cb = dirStatCallbacks.shift();
    assert.ok(cb, 'expected a dir stat callback');
    cb!(err || new Error('ENOENT'), null as unknown as FakeStat);
  }

  function resolveStat(basename: string, stat: FakeStat): void {
    const cbs = statCallbacks[basename];
    assert.ok(cbs && cbs.length > 0, `expected a stat callback for ${basename}`);
    const cb = cbs.shift()!;
    cb(null, stat);
  }

  function rejectStat(basename: string, err?: Error): void {
    const cbs = statCallbacks[basename];
    assert.ok(cbs && cbs.length > 0, `expected a stat callback for ${basename}`);
    const cb = cbs.shift()!;
    cb(err || new Error('ENOENT'), null as unknown as FakeStat);
  }

  return {
    watcher,
    mockWatcherEE,
    watcherFactory,
    mockFs,
    resolveReaddir,
    resolveDirStat,
    rejectDirStat,
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

  it('uses fast path for empty dir when dir mtime matches cache', async () => {
    const cachedMtime = 1_700_000_000_000;
    const onDirMtime = sinon.spy();
    const { watcher, mockFs, resolveDirStat } = setupWatcher({
      cachedDirMtime: cachedMtime,
      initialEntries: new Map(),
      onDirMtime,
      dirStat: true,
    });

    const end = sinon.spy();
    watcher.on('end', end);

    await wait();
    resolveDirStat(makeStat(0, cachedMtime, true));
    await wait();

    assert.strictEqual(mockFs.readdir.callCount, 0, 'readdir not called');
    assert.strictEqual(end.callCount, 1, 'end fired');
  });

  it('uses fast path when dir mtime matches cache, emitting cached entries without readdir', async () => {
    const cachedMtime = 1_700_000_000_000;
    const initialEntries = new Map([
      ['foo.jpg', { size: 1000, mtimeMs: cachedMtime, isDirectory: false }],
    ]);
    const onDirMtime = sinon.spy();
    const { watcher, mockFs, resolveDirStat } = setupWatcher({
      cachedDirMtime: cachedMtime,
      initialEntries,
      onDirMtime,
      dirStat: true,  // use manual dirStat control
    });

    const add = sinon.spy();
    const end = sinon.spy();
    watcher.on('add', add);
    watcher.on('end', end);

    await wait();

    // Resolve dir stat with matching mtime — fast path should kick in
    resolveDirStat(makeStat(0, cachedMtime, true));

    await wait();

    assert.strictEqual(mockFs.readdir.callCount, 0, 'readdir was NOT called on fast path');
    assert.strictEqual(add.callCount, 1, 'cached entry was emitted');
    assert.strictEqual(add.firstCall.args[0], path.join(TEST_DIR, 'foo.jpg'), 'correct full path');
    assert.strictEqual(end.callCount, 1, 'end fired');
    assert.strictEqual(onDirMtime.callCount, 0, 'onDirMtime not called on fast path (mtime already known)');
  });

  it('falls back to slow path when dir mtime differs from cache', async () => {
    const cachedMtime = 1_700_000_000_000;
    const newDirMtime = 1_700_000_001_000;
    const initialEntries = new Map([
      ['foo.jpg', { size: 1000, mtimeMs: cachedMtime, isDirectory: false }],
    ]);
    const onDirMtime = sinon.spy();
    const { watcher, mockFs, resolveReaddir, resolveDirStat, resolveStat } = setupWatcher({
      cachedDirMtime: cachedMtime,
      initialEntries,
      onDirMtime,
      dirStat: true,
    });

    const add = sinon.spy();
    watcher.on('add', add);

    await wait();

    // Dir mtime changed — must fall back to full scan
    resolveDirStat(makeStat(0, newDirMtime, true));
    await wait();

    resolveReaddir(['foo.jpg', 'bar.jpg']);
    resolveStat('foo.jpg', makeStat(1000, cachedMtime));
    resolveStat('bar.jpg', makeStat(2000, cachedMtime));
    await wait();

    assert.strictEqual(mockFs.readdir.callCount, 1, 'readdir called on slow path');
    assert.strictEqual(add.callCount, 2, 'both files emitted');
    assert.strictEqual(onDirMtime.callCount, 1, 'onDirMtime called with new mtime after full scan');
    assert.strictEqual(onDirMtime.firstCall.args[0], newDirMtime, 'new dir mtime persisted');
  });

  it('takes slow path when dir stat fails, and does not call onDirMtime', async () => {
    const cachedMtime = 1_700_000_000_000;
    const initialEntries = new Map([
      ['foo.jpg', { size: 1000, mtimeMs: cachedMtime, isDirectory: false }],
    ]);
    const onDirMtime = sinon.spy();
    const { watcher, resolveReaddir, resolveStat, rejectDirStat } = setupWatcher({
      cachedDirMtime: cachedMtime,
      initialEntries,
      onDirMtime,
      dirStat: true,
    });

    const add = sinon.spy();
    watcher.on('add', add);

    await wait();

    rejectDirStat(new Error('EPERM'));
    await wait();

    resolveReaddir(['foo.jpg']);
    resolveStat('foo.jpg', makeStat(1000, cachedMtime));
    await wait();

    assert.strictEqual(add.callCount, 1, 'file still emitted via slow path');
    assert.strictEqual(onDirMtime.callCount, 0, 'onDirMtime not called when dir stat failed');
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
