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

import {assert} from 'chai';
import {FolderStateHelper} from './folder-state-helper';

function getFolderNames(folders) {
  return folders.map((folder) => folder.filename);
}

function getFileNames(files) {
  return files.map((file) => file.name);
}

describe('FolderStateHelper', () => {
  it('sorts by full path all at once', () => {
    const root = FolderStateHelper.createRoot('sortPath');
    FolderStateHelper.updateFolders(root, {
      'b/a': { files: { 'b/a/e': {}, 'b/a/f': {}, 'b/a/d': {}, }},
      'c/a': { files: { 'c/a/f': {}, 'c/a/d': {}, 'c/a/e': {}, }},
      'a/a': { files: { 'a/a/d': {}, 'a/a/f': {}, 'a/a/e': {}, }},
    });
    assert.strictEqual(root.totalFiles, 9);
    assert.sameOrderedMembers(getFolderNames(root.folders), ['a/a', 'b/a', 'c/a']);
    assert.strictEqual(root.folders.length, 3);
    assert.sameOrderedMembers(getFileNames(root.folders[0].files), ['a/a/d', 'a/a/e', 'a/a/f']);
    assert.sameOrderedMembers(getFileNames(root.folders[1].files), ['b/a/d', 'b/a/e', 'b/a/f']);
    assert.sameOrderedMembers(getFileNames(root.folders[2].files), ['c/a/d', 'c/a/e', 'c/a/f']);
  });

  it('sorts by full path a little at a time', () => {
    const root = FolderStateHelper.createRoot('sortPath');
    FolderStateHelper.updateFolders(root, {
      'b/a': { files: { 'b/a/e': {}, 'b/a/f': {}, 'b/a/d': {}, }},
    });
    FolderStateHelper.updateFolders(root, {
      'c/a': { files: { 'c/a/f': {}, 'c/a/d': {}, 'c/a/e': {}, }},
    });
    FolderStateHelper.updateFolders(root, {
      'a/a': { files: { 'a/a/d': {}, 'a/a/f': {}, 'a/a/e': {}, }},
    });
    assert.strictEqual(root.totalFiles, 9);
    assert.sameOrderedMembers(getFolderNames(root.folders), ['a/a', 'b/a', 'c/a']);
    assert.strictEqual(root.folders.length, 3);
    assert.sameOrderedMembers(getFileNames(root.folders[0].files), ['a/a/d', 'a/a/e', 'a/a/f']);
    assert.sameOrderedMembers(getFileNames(root.folders[1].files), ['b/a/d', 'b/a/e', 'b/a/f']);
    assert.sameOrderedMembers(getFileNames(root.folders[2].files), ['c/a/d', 'c/a/e', 'c/a/f']);
  });

  it('sorts by full path on update', () => {
    const root = FolderStateHelper.createRoot('sortPath');
    FolderStateHelper.updateFolders(root, {
      'b/a': { files: { 'b/a/e': {}, 'b/a/f': {}, 'b/a/d': {}, }},
      'c/a': { files: { 'c/a/f': {}, 'c/a/d': {}, 'c/a/e': {}, }},
      'a/a': { files: { 'a/a/d': {}, 'a/a/f': {}, 'a/a/e': {}, }},
    });
    FolderStateHelper.updateFolders(root, {
      'b/a': { files: { 'b/a/e': {}, 'b/a/f': {}, 'b/a/d': {}, }},
    });
    FolderStateHelper.updateFolders(root, {
      'c/a': { files: { 'c/a/f': {}, 'c/a/d': {}, 'c/a/e': {}, }},
    });
    FolderStateHelper.updateFolders(root, {
      'a/a': { files: { 'a/a/d': {}, 'a/a/f': {}, 'a/a/e': {}, }},
    });
    assert.strictEqual(root.totalFiles, 9);
    assert.sameOrderedMembers(getFolderNames(root.folders), ['a/a', 'b/a', 'c/a']);
    assert.strictEqual(root.folders.length, 3);
    assert.sameOrderedMembers(getFileNames(root.folders[0].files), ['a/a/d', 'a/a/e', 'a/a/f']);
    assert.sameOrderedMembers(getFileNames(root.folders[1].files), ['b/a/d', 'b/a/e', 'b/a/f']);
    assert.sameOrderedMembers(getFileNames(root.folders[2].files), ['c/a/d', 'c/a/e', 'c/a/f']);
  });

  it('sorts by name all at once', () => {
    const root = FolderStateHelper.createRoot('sortName');
    FolderStateHelper.updateFolders(root, {
      'b/z': { files: { 'b/z/e': {}, 'b/z/f': {}, 'b/z/d': {}, }},
      'c/x': { files: { 'c/x/f': {}, 'c/x/d': {}, 'c/x/e': {}, }},
      'a/y': { files: { 'a/y/d': {}, 'a/y/f': {}, 'a/y/e': {}, }},
    });
    assert.strictEqual(root.totalFiles, 9);
    assert.sameOrderedMembers(getFolderNames(root.folders), ['c/x', 'a/y', 'b/z']);
    assert.strictEqual(root.folders.length, 3);
    assert.sameOrderedMembers(getFileNames(root.folders[0].files), ['c/x/d', 'c/x/e', 'c/x/f']);
    assert.sameOrderedMembers(getFileNames(root.folders[1].files), ['a/y/d', 'a/y/e', 'a/y/f']);
    assert.sameOrderedMembers(getFileNames(root.folders[2].files), ['b/z/d', 'b/z/e', 'b/z/f']);
  });

  it('sorts by name a little at a time', () => {
    const root = FolderStateHelper.createRoot('sortName');
    FolderStateHelper.updateFolders(root, {
      'b/z': { files: { 'b/z/e': {}, 'b/z/f': {}, 'b/z/d': {}, }},
    });
    FolderStateHelper.updateFolders(root, {
      'c/x': { files: { 'c/x/f': {}, 'c/x/d': {}, 'c/x/e': {}, }},
    });
    FolderStateHelper.updateFolders(root, {
      'a/y': { files: { 'a/y/d': {}, 'a/y/f': {}, 'a/y/e': {}, }},
    });
    assert.strictEqual(root.totalFiles, 9);
    assert.sameOrderedMembers(getFolderNames(root.folders), ['c/x', 'a/y', 'b/z']);
    assert.strictEqual(root.folders.length, 3);
    assert.sameOrderedMembers(getFileNames(root.folders[0].files), ['c/x/d', 'c/x/e', 'c/x/f']);
    assert.sameOrderedMembers(getFileNames(root.folders[1].files), ['a/y/d', 'a/y/e', 'a/y/f']);
    assert.sameOrderedMembers(getFileNames(root.folders[2].files), ['b/z/d', 'b/z/e', 'b/z/f']);
  });

  it('sorts by name on update', () => {
    const root = FolderStateHelper.createRoot('sortName');
    FolderStateHelper.updateFolders(root, {
      'b/z': { files: { 'b/z/e': {}, 'b/z/f': {}, 'b/z/d': {}, }},
      'c/x': { files: { 'c/x/f': {}, 'c/x/d': {}, 'c/x/e': {}, }},
      'a/y': { files: { 'a/y/d': {}, 'a/y/f': {}, 'a/y/e': {}, }},
    });
    FolderStateHelper.updateFolders(root, {
      'b/z': { files: { 'b/z/e': {}, 'b/z/f': {}, 'b/z/d': {}, }},
    });
    FolderStateHelper.updateFolders(root, {
      'c/x': { files: { 'c/x/f': {}, 'c/x/d': {}, 'c/x/e': {}, }},
    });
    FolderStateHelper.updateFolders(root, {
      'a/y': { files: { 'a/y/d': {}, 'a/y/f': {}, 'a/y/e': {}, }},
    });
    assert.strictEqual(root.totalFiles, 9);
    assert.sameOrderedMembers(getFolderNames(root.folders), ['c/x', 'a/y', 'b/z']);
    assert.strictEqual(root.folders.length, 3);
    assert.sameOrderedMembers(getFileNames(root.folders[0].files), ['c/x/d', 'c/x/e', 'c/x/f']);
    assert.sameOrderedMembers(getFileNames(root.folders[1].files), ['a/y/d', 'a/y/e', 'a/y/f']);
    assert.sameOrderedMembers(getFileNames(root.folders[2].files), ['b/z/d', 'b/z/e', 'b/z/f']);
  });

  it('sorts by date all at once', () => {
    const root = FolderStateHelper.createRoot('newest');
    FolderStateHelper.updateFolders(root, {
      'b/z': { files: { 'b/z/e': { mtime: 9, }, 'b/z/f': { mtime: 7, }, 'b/z/d': { mtime: 8, }, }},
      'a/y': { files: { 'a/y/d': { mtime: 1, }, 'a/y/f': { mtime: 3, }, 'a/y/e': { mtime: 2, }, }},
      'c/x': { files: { 'c/x/f': { mtime: 5, }, 'c/x/d': { mtime: 4, }, 'c/x/e': { mtime: 6, }, }},
    });
    assert.strictEqual(root.totalFiles, 9);
    assert.sameOrderedMembers(getFolderNames(root.folders), ['b/z', 'c/x', 'a/y']);
    assert.strictEqual(root.folders.length, 3);
    assert.sameOrderedMembers(getFileNames(root.folders[0].files), ['b/z/e', 'b/z/d', 'b/z/f']);
    assert.sameOrderedMembers(getFileNames(root.folders[1].files), ['c/x/e', 'c/x/f', 'c/x/d']);
    assert.sameOrderedMembers(getFileNames(root.folders[2].files), ['a/y/f', 'a/y/e', 'a/y/d']);
  });

  it('sorts by numbers', () => {
    {
      const root = FolderStateHelper.createRoot('sortPath');
      FolderStateHelper.updateFolders(root, {
        'a': { files: { 'a/e-3': {}, 'a/e-01': {}, 'a/e-002': {}, }},
      });
      assert.strictEqual(root.totalFiles, 3);
      assert.strictEqual(root.folders.length, 1);
      assert.sameOrderedMembers(getFileNames(root.folders[0].files), ['a/e-01', 'a/e-002', 'a/e-3']);
    }
    {
      const root = FolderStateHelper.createRoot('sortPath');
      FolderStateHelper.updateFolders(root, {
        'a/e-3': { files: { 'a/e-3/b': {} }},
        'a/e-01': { files: { 'a/e-01/b': {} }},
        'a/e-002': { files: { 'a/e-002/b': {}, }},
      });
      assert.strictEqual(root.totalFiles, 3);
      assert.strictEqual(root.folders.length, 3);
      assert.sameOrderedMembers(getFolderNames(root.folders), ['a/e-01', 'a/e-002', 'a/e-3']);
    }
  });
});

