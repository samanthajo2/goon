import { assert } from 'chai';
import VirtualFolderIndex from './virtual-folder-index.js';
import { VirtualFolderFsAPI } from './virtual-folder-data.js';

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

describe('VirtualFolderIndex', () => {
  it('adds and lists in registration order', () => {
    const fs = makeFakeFs();
    const idx = new VirtualFolderIndex({ fs, dataDir });
    idx.add('a', 'Alpha');
    idx.add('b', 'Beta');
    assert.deepEqual(idx.list(), [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]);
    assert.isTrue(idx.has('a'));
    assert.isFalse(idx.has('z'));
    assert.strictEqual(idx.getName('b'), 'Beta');
  });

  it('add updates the name of an existing id (no duplicate)', () => {
    const fs = makeFakeFs();
    const idx = new VirtualFolderIndex({ fs, dataDir });
    idx.add('a', 'Alpha');
    idx.add('a', 'Alpha2');
    assert.deepEqual(idx.list(), [{ id: 'a', name: 'Alpha2' }]);
  });

  it('rename and remove', () => {
    const fs = makeFakeFs();
    const idx = new VirtualFolderIndex({ fs, dataDir });
    idx.add('a', 'Alpha');
    idx.add('b', 'Beta');
    idx.rename('a', 'Aleph');
    assert.strictEqual(idx.getName('a'), 'Aleph');
    idx.remove('a');
    assert.isFalse(idx.has('a'));
    assert.deepEqual(idx.list(), [{ id: 'b', name: 'Beta' }]);
  });

  it('noteRecent moves to front, de-dupes, and caps at 5', () => {
    const fs = makeFakeFs();
    const idx = new VirtualFolderIndex({ fs, dataDir });
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) idx.add(id, id.toUpperCase());
    idx.noteRecent('a');
    idx.noteRecent('b');
    idx.noteRecent('c');
    idx.noteRecent('d');
    idx.noteRecent('e');
    idx.noteRecent('f'); // pushes 'a' out (cap 5)
    idx.noteRecent('c'); // moves 'c' back to front
    assert.deepEqual(idx.getRecent().map(e => e.id), ['c', 'f', 'e', 'd', 'b']);
  });

  it('noteRecent ignores unknown ids', () => {
    const fs = makeFakeFs();
    const idx = new VirtualFolderIndex({ fs, dataDir });
    idx.add('a', 'Alpha');
    idx.noteRecent('ghost');
    assert.deepEqual(idx.getRecent(), []);
  });

  it('removing a folder drops it from recent', () => {
    const fs = makeFakeFs();
    const idx = new VirtualFolderIndex({ fs, dataDir });
    idx.add('a', 'Alpha');
    idx.add('b', 'Beta');
    idx.noteRecent('a');
    idx.noteRecent('b');
    idx.remove('a');
    assert.deepEqual(idx.getRecent().map(e => e.id), ['b']);
  });

  it('round-trips through disk (flush then reload)', () => {
    const fs = makeFakeFs();
    const a = new VirtualFolderIndex({ fs, dataDir });
    a.add('a', 'Alpha');
    a.add('b', 'Beta');
    a.noteRecent('b');
    a.flush();

    const b = new VirtualFolderIndex({ fs, dataDir });
    assert.deepEqual(b.list(), [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]);
    assert.deepEqual(b.getRecent().map(e => e.id), ['b']);
  });
});
