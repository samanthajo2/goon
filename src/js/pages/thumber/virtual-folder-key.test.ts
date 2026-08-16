import { assert } from 'chai';
import { makeVirtualFolderKey, isVirtualFolderKey, virtualFolderIdFromKey } from './virtual-folder-key.js';

describe('virtualFolderKey', () => {
  it('round-trips id → key → id', () => {
    const key = makeVirtualFolderKey('abc-123');
    assert.strictEqual(key, 'vfolder:abc-123');
    assert.isTrue(isVirtualFolderKey(key));
    assert.strictEqual(virtualFolderIdFromKey(key), 'abc-123');
  });

  it('recognizes non-virtual keys', () => {
    assert.isFalse(isVirtualFolderKey('/real/folder/path'));
    assert.isFalse(isVirtualFolderKey('C:/Users/me/pics'));
    assert.isUndefined(virtualFolderIdFromKey('/real/folder'));
  });

  it('handles ids containing separators/colons', () => {
    const key = makeVirtualFolderKey('a:b/c');
    assert.isTrue(isVirtualFolderKey(key));
    assert.strictEqual(virtualFolderIdFromKey(key), 'a:b/c');
  });
});
