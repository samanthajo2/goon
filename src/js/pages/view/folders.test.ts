import { assert } from 'chai';
import { buildFolderEntries, computeIndentedNames } from './folders.js';
import type { FolderStateFolder } from './folder-state-helper.js';

function fsf(filename: string, name: string, numFiles = 1): FolderStateFolder {
  return {
    filename,
    name,
    sortName: filename,
    files: new Array(numFiles).fill({}),
    totalFiles: numFiles,
    newest: 0,
    oldest: 0,
    scanning: false,
    checking: false,
  } as unknown as FolderStateFolder;
}

describe('folders sidebar helpers', () => {
  // Regression: a virtual folder's synthetic `vfolder:<id>` key has no path
  // separators, so path.dirname reaches a fixed point ('.') — the ancestor walk
  // must not spin forever (it froze the app before the fix). If it regressed, these
  // tests would hang (mocha timeout) instead of passing.
  it('buildFolderEntries does not hang on a virtual folder key and uses its name', () => {
    const entries = buildFolderEntries(['/pics'], [fsf('vfolder:abc-123', 'foo')], /* withVirtualAncestors */ true);
    const vf = entries.find(e => e.filename === 'vfolder:abc-123');
    assert.ok(vf, 'virtual folder entry present');
    assert.strictEqual(vf!.name, 'foo', 'uses the virtual folder display name');
    assert.notOk(entries.some(e => e.filename === '.'), 'no bogus "." ancestor synthesized');
  });

  it('computeIndentedNames does not hang on a virtual folder key', () => {
    const names = computeIndentedNames(['/pics'], ['vfolder:abc-123']);
    assert.strictEqual(names.length, 1);
  });

  it('still synthesizes real-folder ancestors', () => {
    const entries = buildFolderEntries(['/pics'], [fsf('/pics/a/b', 'b')], true);
    const filenames = entries.map(e => e.filename);
    assert.include(filenames, '/pics/a', 'ancestor /pics/a synthesized');
    assert.include(filenames, '/pics/a/b', 'real folder present');
    const ancestor = entries.find(e => e.filename === '/pics/a');
    assert.strictEqual(ancestor!.numFiles, 0, 'synthesized ancestor has no files');
  });

  it('mixed real + virtual folders both appear', () => {
    const entries = buildFolderEntries(['/pics'], [fsf('/pics/a', 'a'), fsf('vfolder:xyz', 'Favorites')], true);
    const filenames = entries.map(e => e.filename);
    assert.include(filenames, '/pics/a');
    assert.include(filenames, 'vfolder:xyz');
  });
});
