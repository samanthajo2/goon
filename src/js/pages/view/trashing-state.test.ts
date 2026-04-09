import { assert } from 'chai';
import {
  trashingFiles,
  addTrashingFile,
  removeTrashingFile,
  subscribeTrashingFiles,
} from './trashing-state.js';

function clearState(): void {
  trashingFiles.clear();
}

describe('trashingState', () => {
  beforeEach(clearState);
  afterEach(clearState);

  describe('addTrashingFile / removeTrashingFile', () => {
    it('adds a file to trashingFiles', () => {
      addTrashingFile('/a/b.jpg');
      assert.isTrue(trashingFiles.has('/a/b.jpg'));
    });

    it('removes a file from trashingFiles', () => {
      addTrashingFile('/a/b.jpg');
      removeTrashingFile('/a/b.jpg');
      assert.isFalse(trashingFiles.has('/a/b.jpg'));
    });

    it('handles removing a file that was never added', () => {
      assert.doesNotThrow(() => removeTrashingFile('/nope.jpg'));
    });
  });

  describe('subscribeTrashingFiles', () => {
    it('calls the listener when a file is added', () => {
      let calls = 0;
      subscribeTrashingFiles(() => { calls++; });
      addTrashingFile('/x.jpg');
      assert.equal(calls, 1);
    });

    it('calls the listener when a file is removed', () => {
      let calls = 0;
      addTrashingFile('/x.jpg');
      subscribeTrashingFiles(() => { calls++; });
      removeTrashingFile('/x.jpg');
      assert.equal(calls, 1);
    });

    it('returns an unsubscribe function that stops notifications', () => {
      let calls = 0;
      const unsub = subscribeTrashingFiles(() => { calls++; });
      unsub();
      addTrashingFile('/x.jpg');
      assert.equal(calls, 0);
    });

    it('supports multiple independent subscribers', () => {
      let a = 0;
      let b = 0;
      const unsubA = subscribeTrashingFiles(() => { a++; });
      subscribeTrashingFiles(() => { b++; });
      addTrashingFile('/x.jpg');
      unsubA();
      addTrashingFile('/y.jpg');
      assert.equal(a, 1);
      assert.equal(b, 2);
    });
  });
});
