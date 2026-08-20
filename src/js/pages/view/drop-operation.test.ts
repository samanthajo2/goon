import { assert } from 'chai';
import { computeDropOperation } from './drop-operation.js';

describe('computeDropOperation (drag/drop matrix)', () => {
  it('native → native: move, copy with modifier (toggle to the other)', () => {
    assert.deepEqual(computeDropOperation('native', 'native', false), { op: 'move', alt: 'copy' });
    assert.deepEqual(computeDropOperation('native', 'native', true), { op: 'copy', alt: 'move' });
  });

  it('native → virtual: add', () => {
    assert.strictEqual(computeDropOperation('native', 'virtual', false).op, 'add');
    assert.strictEqual(computeDropOperation('native', 'virtual', true).op, 'add');
  });

  it('archive → native: copy (never move, modifier irrelevant)', () => {
    assert.strictEqual(computeDropOperation('archive', 'native', false).op, 'copy');
    assert.strictEqual(computeDropOperation('archive', 'native', true).op, 'copy');
  });

  it('archive → virtual: add', () => {
    assert.strictEqual(computeDropOperation('archive', 'virtual', false).op, 'add');
  });

  it('virtual → native: copy (modifier irrelevant)', () => {
    assert.strictEqual(computeDropOperation('virtual', 'native', false).op, 'copy');
    assert.strictEqual(computeDropOperation('virtual', 'native', true).op, 'copy');
  });

  it('virtual → virtual: move, add with modifier (toggle to the other)', () => {
    assert.deepEqual(computeDropOperation('virtual', 'virtual', false), { op: 'move', alt: 'add' });
    assert.deepEqual(computeDropOperation('virtual', 'virtual', true), { op: 'add', alt: 'move' });
  });

  it('anything → archive: error', () => {
    assert.strictEqual(computeDropOperation('native', 'archive', false).op, 'error');
    assert.strictEqual(computeDropOperation('archive', 'archive', false).op, 'error');
    assert.strictEqual(computeDropOperation('virtual', 'archive', false).op, 'error');
  });
});
