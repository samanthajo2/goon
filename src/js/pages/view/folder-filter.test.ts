import { assert } from 'chai';
import FolderFilter from './folder-filter.js';
import { DBFileInfo, DBFoldersByPath } from './folder-db.js';
import { FolderStatus } from '../../lib/folderinfo.js';

const STATUS: FolderStatus = { checking: false, scanning: false, scannedTime: 0 };

function makeFile(overrides: Partial<DBFileInfo> = {}): DBFileInfo {
  return {
    displayName: 'file.jpg',
    isDirectory: false,
    mtime: 0,
    orientation: 0,
    size: 1000,
    type: 'image/jpeg',
    width: 800,
    height: 600,
    thumbnail: { x: 0, y: 0, width: 100, height: 100, url: '', pageSize: 0 },
    filename: '/folder/file.jpg',
    baseName: 'file.jpg',
    folderName: '/folder',
    lowercaseName: 'file.jpg',
    ...overrides,
  };
}

function makeFolder(files: Record<string, DBFileInfo>, status = STATUS): DBFoldersByPath[string] {
  return { status, files };
}

function runUntilDone(ff: FolderFilter): void {
  while (ff.process()) { /* drain */ }
}

describe('FolderFilter', () => {
  describe('updateFiles + process', () => {
    it('emits updateFiles with all files when filter passes everything', (done) => {
      const ff = new FolderFilter();
      ff.setFilter(() => true);

      const file = makeFile({ filename: '/a/x.jpg', displayName: 'x.jpg' });
      const folders: DBFoldersByPath = { '/a': makeFolder({ '/a/x.jpg': file }) };

      ff.on('updateFiles', (result: DBFoldersByPath) => {
        assert.deepEqual(result['/a'].files['/a/x.jpg'], file);
        done();
      });

      ff.updateFiles(folders);
      setImmediate(() => runUntilDone(ff));
    });

    it('emits updateFiles with no files when filter rejects everything', (done) => {
      const ff = new FolderFilter();
      ff.setFilter(() => false);

      const file = makeFile({ filename: '/a/x.jpg' });
      const folders: DBFoldersByPath = { '/a': makeFolder({ '/a/x.jpg': file }) };

      ff.on('updateFiles', (result: DBFoldersByPath) => {
        assert.equal(Object.keys(result['/a'].files).length, 0);
        done();
      });

      ff.updateFiles(folders);
      setImmediate(() => runUntilDone(ff));
    });

    it('filters files by predicate', (done) => {
      const ff = new FolderFilter();
      ff.setFilter((filename) => filename.endsWith('.jpg'));

      const jpg = makeFile({ filename: '/a/x.jpg' });
      const png = makeFile({ filename: '/a/y.png', displayName: 'y.png', baseName: 'y.png' });
      const folders: DBFoldersByPath = {
        '/a': makeFolder({ '/a/x.jpg': jpg, '/a/y.png': png }),
      };

      ff.on('updateFiles', (result: DBFoldersByPath) => {
        const files = result['/a'].files;
        assert.property(files, '/a/x.jpg');
        assert.notProperty(files, '/a/y.png');
        done();
      });

      ff.updateFiles(folders);
      setImmediate(() => runUntilDone(ff));
    });

    it('process() returns false when no pending work', () => {
      const ff = new FolderFilter();
      ff.setFilter(() => true);
      assert.isFalse(ff.process());
    });

    it('replaces a pending folder when the same folderName is updated twice', (done) => {
      const ff = new FolderFilter();
      ff.setFilter(() => true);

      const file1 = makeFile({ filename: '/a/old.jpg', displayName: 'old.jpg' });
      const file2 = makeFile({ filename: '/a/new.jpg', displayName: 'new.jpg', baseName: 'new.jpg' });

      ff.updateFiles({ '/a': makeFolder({ '/a/old.jpg': file1 }) });
      ff.updateFiles({ '/a': makeFolder({ '/a/new.jpg': file2 }) });

      ff.on('updateFiles', (result: DBFoldersByPath) => {
        const files = result['/a'].files;
        assert.property(files, '/a/new.jpg');
        assert.notProperty(files, '/a/old.jpg');
        done();
      });

      setImmediate(() => runUntilDone(ff));
    });
  });

  describe('setFilter', () => {
    it('clears pending folders when filter changes', () => {
      const ff = new FolderFilter();
      ff.setFilter(() => true);
      const file = makeFile();
      ff.updateFiles({ '/a': makeFolder({ '/a/x.jpg': file }) });
      // Immediately change filter before processing
      ff.setFilter(() => false);
      // No pending folders remain — process returns false immediately
      assert.isFalse(ff.process());
    });

    it('cancels in-flight results from the previous filter', (done) => {
      const ff = new FolderFilter();
      const results: DBFoldersByPath[] = [];
      ff.on('updateFiles', (folders: DBFoldersByPath) => results.push(folders));

      ff.setFilter(() => true);
      const file = makeFile({ filename: '/a/x.jpg' });
      ff.updateFiles({ '/a': makeFolder({ '/a/x.jpg': file }) });

      // Immediately switch filter — cancels the previous batch's nextTick emission
      ff.setFilter(() => false);

      setImmediate(() => {
        runUntilDone(ff);
        setImmediate(() => {
          // Any results that did arrive should have no files (second filter passes nothing)
          for (const r of results) {
            for (const folder of Object.values(r)) {
              assert.equal(Object.keys(folder.files).length, 0);
            }
          }
          done();
        });
      });
    });
  });
});
