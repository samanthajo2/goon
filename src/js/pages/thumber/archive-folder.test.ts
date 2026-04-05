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

import sinon from 'sinon';
import { describe, it, afterEach } from '../../lib/test/mocha';
import { assert } from 'chai';
import ArchiveFolder from './archive-folder';
import wait from './../../lib/wait';

describe('ArchiveFolder', () => {
  afterEach(() => {
    sinon.restore();
  });

  type SetupOptions = {
    mtimeMs?: number;
    scannedTime?: number;
    thumbnailPageMaker?: sinon.SinonStub;
  };

  function setupArchiveFolder({ mtimeMs = 1000, scannedTime = undefined, thumbnailPageMaker = sinon.stub() }: SetupOptions = {}) {
    const folderData = {
      files: {} as Record<string, unknown>,
      baseFilename: 'archive_base',
      scannedTime,
      addFiles(files: Record<string, unknown>) { Object.assign(folderData.files, files); },
      removeFiles(keys: string[]) { for (const k of keys) delete folderData.files[k]; },
      setScannedTime: sinon.stub().callsFake((time?: number) => {
        folderData.scannedTime = time !== undefined ? time : Date.now();
      }),
      deleteData: sinon.spy(),
    };

    const fs = {
      statSync: sinon.stub().returns({mtimeMs}),
      unlinkSync: sinon.spy(),
    };

    const folder = new ArchiveFolder('/path/to/archive.zip', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      folderData: folderData as any,
      fs,
      thumbnailPageMakerFn: thumbnailPageMaker,
    });

    const updateFiles = sinon.spy();
    folder.on('updateFiles', updateFiles);

    return {folder, folderData, thumbnailPageMaker, updateFiles};
  }

  it('does not scan if scannedTime is newer than the archive mtime', async () => {
    const thumbnailPageMaker = sinon.stub().resolves({});
    // scannedTime (2000) > mtimeMs (1000) → up to date, no scan needed
    setupArchiveFolder({mtimeMs: 1000, scannedTime: 2000, thumbnailPageMaker});
    await wait();
    assert.strictEqual(thumbnailPageMaker.callCount, 0, 'no scan when archive is up to date');
  });

  it('scans if the archive mtime is newer than scannedTime', async () => {
    const thumbnailPageMaker = sinon.stub().resolves({});
    // mtimeMs (2000) > scannedTime (1000) → archive changed, scan needed
    setupArchiveFolder({mtimeMs: 2000, scannedTime: 1000, thumbnailPageMaker});
    await wait();
    await wait();
    assert.strictEqual(thumbnailPageMaker.callCount, 1, 'scan triggered when archive is newer than scannedTime');
  });

  it('scans on first run when no scannedTime exists', async () => {
    const thumbnailPageMaker = sinon.stub().resolves({});
    setupArchiveFolder({thumbnailPageMaker});
    await wait();
    await wait();
    assert.strictEqual(thumbnailPageMaker.callCount, 1, 'scan triggered on first run');
  });

  it('rescans after update() is called while a scan is in progress', async () => {
    // Deferred first scan so we control when it completes
    let resolveFirst: (() => void) | undefined;
    const thumbnailPageMaker = sinon.stub();
    thumbnailPageMaker.onFirstCall().returns(new Promise(r => { resolveFirst = () => r({}); }));
    thumbnailPageMaker.onSecondCall().resolves({});

    const {folder} = setupArchiveFolder({thumbnailPageMaker});
    await wait(); // nextTick fires → scan starts

    assert.strictEqual(thumbnailPageMaker.callCount, 1, 'first scan running');

    // Simulate the archive being modified while the scan is in progress
    folder.update();
    assert.strictEqual(thumbnailPageMaker.callCount, 1, 'no second scan started immediately');

    // Complete the first scan
    resolveFirst!();
    await wait();
    await wait();

    assert.strictEqual(thumbnailPageMaker.callCount, 2, 'second scan triggered after first completes');
  });

  it('sets scannedTime to the pre-scan timestamp so modifications during the scan are detected on restart', async () => {
    // Pin Date.now() to 1000 at scan start, then advance to 1500 mid-scan.
    // The fix records scanStartTime before the async work begins, so
    // setScannedTime should be called with 1000, not 1500.
    // Only fake Date so setTimeout/setImmediate/nextTick keep working normally
    const clock = sinon.useFakeTimers({now: 1000, toFake: ['Date']});

    let resolveFirst: (() => void) | undefined;
    const thumbnailPageMaker = sinon.stub().returns(
      new Promise(r => { resolveFirst = () => r({}); }),
    );

    const {folderData} = setupArchiveFolder({thumbnailPageMaker});
    await wait(); // nextTick fires → _updateThumbnails starts, scanStartTime = 1000

    // Advance the clock to simulate time passing during the async scan
    clock.tick(500); // Date.now() is now 1500

    // Complete the scan — finally block should call setScannedTime(1000), not setScannedTime(1500)
    resolveFirst!();
    await wait();
    await wait();

    assert.ok(folderData.setScannedTime.calledOnce, 'setScannedTime called once');
    const scannedTimeArg = folderData.setScannedTime.firstCall.args[0];
    assert.strictEqual(
      scannedTimeArg,
      1000,
      'scannedTime is pre-scan time (1000), not post-scan time (1500)',
    );
  });
});
