import { describe, it } from '../../lib/test/mocha.js';
import { assert } from 'chai';
import { sanitizeFolderName } from './rename-folder-prompt.js';

describe('sanitizeFolderName', () => {
  it('strips path separators and colons so a rename cannot become a move', () => {
    assert.strictEqual(sanitizeFolderName('a/b'), 'ab');
    assert.strictEqual(sanitizeFolderName('a\\b'), 'ab');
    assert.strictEqual(sanitizeFolderName('C:name'), 'Cname');
    assert.strictEqual(sanitizeFolderName('../etc/passwd'), '..etcpasswd');
  });

  it('leaves ordinary names untouched', () => {
    assert.strictEqual(sanitizeFolderName('Beach 2024'), 'Beach 2024');
    assert.strictEqual(sanitizeFolderName('summer_pics'), 'summer_pics');
  });
});
