import { assert } from 'chai';
import VirtualFolderData, { VirtualFolderFsAPI } from './virtual-folder-data.js';

// In-memory fake fs implementing the small API VirtualFolderData needs.
function makeFakeFs(): VirtualFolderFsAPI & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    existsSync: (p: string) => files.has(p),
    readFileAsStringSync: (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeFileSync: (p: string, data: string | Buffer) => { files.set(p, String(data)); },
    unlinkSync: (p: string) => { files.delete(p); },
  };
}

const dataDir = '/data';

describe('VirtualFolderData', () => {
  it('starts empty; name defaults to id', () => {
    const fs = makeFakeFs();
    const vf = new VirtualFolderData('id1', { fs, dataDir });
    assert.strictEqual(vf.id, 'id1');
    assert.strictEqual(vf.name, 'id1');
    assert.deepEqual(vf.files, []);
    assert.isFalse(vf.exists);
  });

  it('uses the provided name and a vfolder-prefixed basename', () => {
    const fs = makeFakeFs();
    const vf = new VirtualFolderData('id1', { fs, dataDir, name: 'Favorites' });
    assert.strictEqual(vf.name, 'Favorites');
    assert.match(vf.baseFilename, /[/\\]vfolder-[0-9a-f]{64}$/);
  });

  it('addFiles preserves order and de-dupes', () => {
    const fs = makeFakeFs();
    const vf = new VirtualFolderData('id1', { fs, dataDir });
    assert.isTrue(vf.addFiles(['/a.jpg', '/b.jpg']));
    assert.isTrue(vf.addFiles(['/b.jpg', '/c.jpg'])); // b is a dup
    assert.deepEqual(vf.files, ['/a.jpg', '/b.jpg', '/c.jpg']);
    assert.isFalse(vf.addFiles(['/a.jpg']), 'no change when all already present');
  });

  it('removeFiles removes and reports change', () => {
    const fs = makeFakeFs();
    const vf = new VirtualFolderData('id1', { fs, dataDir });
    vf.addFiles(['/a.jpg', '/b.jpg', '/c.jpg']);
    assert.isTrue(vf.removeFiles(['/b.jpg', '/nope.jpg']));
    assert.deepEqual(vf.files, ['/a.jpg', '/c.jpg']);
    assert.isFalse(vf.removeFiles(['/nope.jpg']));
  });

  it('setName updates and reports change', () => {
    const fs = makeFakeFs();
    const vf = new VirtualFolderData('id1', { fs, dataDir });
    assert.isTrue(vf.setName('New'));
    assert.strictEqual(vf.name, 'New');
    assert.isFalse(vf.setName('New'));
  });

  it('round-trips through disk (flush then reload)', () => {
    const fs = makeFakeFs();
    const a = new VirtualFolderData('id1', { fs, dataDir, name: 'Favorites' });
    a.addFiles(['/a.jpg', '/b.jpg']);
    a.flush();

    const b = new VirtualFolderData('id1', { fs, dataDir });
    assert.isTrue(b.exists);
    assert.strictEqual(b.name, 'Favorites');
    assert.deepEqual(b.files, ['/a.jpg', '/b.jpg']);
  });

  it('deleteData removes the file and does not resurrect it', () => {
    const fs = makeFakeFs();
    const a = new VirtualFolderData('id1', { fs, dataDir });
    a.addFiles(['/a.jpg']);
    a.flush();
    assert.strictEqual(fs.files.size, 1);

    a.deleteData();
    assert.strictEqual(fs.files.size, 0);
    a.addFiles(['/late.jpg']); // any queued write must be cancelled
    a.flush();
    assert.strictEqual(fs.files.size, 0, 'delete is sticky');

    const reloaded = new VirtualFolderData('id1', { fs, dataDir });
    assert.isFalse(reloaded.exists);
    assert.deepEqual(reloaded.files, []);
  });

  it('readOnly never writes', () => {
    const fs = makeFakeFs();
    const vf = new VirtualFolderData('id1', { fs, dataDir, readOnly: true });
    vf.addFiles(['/a.jpg']);
    vf.flush();
    assert.strictEqual(fs.files.size, 0);
  });
});
