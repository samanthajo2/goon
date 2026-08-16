import { assert } from 'chai';
import {
  isSelected,
  getSelectedEntries,
  getSelectedFilenames,
  selectionCount,
  toggleSelection,
  shiftToggleSelection,
  selectEntries,
  clearSelection,
} from './selection-state.js';

const FA = '/folderA';
const FB = '/folderB';
const VF = 'vfolder:favorites';

describe('selectionState', () => {
  beforeEach(clearSelection);
  afterEach(clearSelection);

  it('toggles a single entry', () => {
    toggleSelection(FA, 'a.jpg');
    assert.isTrue(isSelected(FA, 'a.jpg'));
    assert.strictEqual(selectionCount(), 1);
    toggleSelection(FA, 'a.jpg');
    assert.isFalse(isSelected(FA, 'a.jpg'));
    assert.strictEqual(selectionCount(), 0);
  });

  it('keys selection by (folderKey, filename) — same file in two folders selects independently', () => {
    // A file referenced by both its real folder and a virtual folder.
    toggleSelection(FA, '/real/pic.jpg');
    assert.isTrue(isSelected(FA, '/real/pic.jpg'));
    assert.isFalse(isSelected(VF, '/real/pic.jpg'), 'the virtual-folder entry is a different selection');
    assert.strictEqual(selectionCount(), 1);

    toggleSelection(VF, '/real/pic.jpg');
    assert.isTrue(isSelected(VF, '/real/pic.jpg'));
    assert.isTrue(isSelected(FA, '/real/pic.jpg'));
    assert.strictEqual(selectionCount(), 2, 'two independent entries selected');

    // Deselecting one leaves the other.
    toggleSelection(FA, '/real/pic.jpg');
    assert.isFalse(isSelected(FA, '/real/pic.jpg'));
    assert.isTrue(isSelected(VF, '/real/pic.jpg'));
  });

  it('getSelectedFilenames returns unique paths across folders', () => {
    toggleSelection(FA, '/real/pic.jpg');
    toggleSelection(VF, '/real/pic.jpg'); // same path, different folder
    toggleSelection(FB, '/other/two.jpg');
    assert.strictEqual(selectionCount(), 3);
    assert.sameMembers(getSelectedFilenames(), ['/real/pic.jpg', '/other/two.jpg']);
  });

  it('getSelectedEntries returns folderKey + filename pairs', () => {
    toggleSelection(FA, 'a.jpg');
    toggleSelection(VF, 'a.jpg');
    assert.sameDeepMembers(getSelectedEntries(), [
      { folderKey: FA, filename: 'a.jpg' },
      { folderKey: VF, filename: 'a.jpg' },
    ]);
  });

  it('selectEntries bulk-adds', () => {
    selectEntries([
      { folderKey: FA, filename: 'a.jpg' },
      { folderKey: FA, filename: 'b.jpg' },
    ]);
    assert.strictEqual(selectionCount(), 2);
    assert.isTrue(isSelected(FA, 'a.jpg'));
    assert.isTrue(isSelected(FA, 'b.jpg'));
  });

  it('clearSelection empties everything', () => {
    toggleSelection(FA, 'a.jpg');
    toggleSelection(FB, 'b.jpg');
    clearSelection();
    assert.strictEqual(selectionCount(), 0);
    assert.isEmpty(getSelectedEntries());
  });

  describe('shiftToggleSelection', () => {
    const ordered = [
      { folderKey: FA, filename: 'a.jpg' },
      { folderKey: FA, filename: 'b.jpg' },
      { folderKey: FA, filename: 'c.jpg' },
      { folderKey: FA, filename: 'd.jpg' },
    ];

    it('with no anchor, acts as a plain toggle', () => {
      shiftToggleSelection({ folderKey: FA, filename: 'b.jpg' }, ordered);
      assert.isTrue(isSelected(FA, 'b.jpg'));
      assert.strictEqual(selectionCount(), 1);
    });

    it('extends a select action across a range', () => {
      toggleSelection(FA, 'a.jpg'); // anchor = select @ a
      shiftToggleSelection({ folderKey: FA, filename: 'c.jpg' }, ordered);
      assert.isTrue(isSelected(FA, 'a.jpg'));
      assert.isTrue(isSelected(FA, 'b.jpg'));
      assert.isTrue(isSelected(FA, 'c.jpg'));
      assert.isFalse(isSelected(FA, 'd.jpg'));
    });

    it('extends a deselect action across a range', () => {
      selectEntries(ordered);
      toggleSelection(FA, 'd.jpg'); // toggles d OFF, anchor = deselect @ d
      assert.isFalse(isSelected(FA, 'd.jpg'));
      shiftToggleSelection({ folderKey: FA, filename: 'b.jpg' }, ordered);
      // range b..d deselected
      assert.isTrue(isSelected(FA, 'a.jpg'));
      assert.isFalse(isSelected(FA, 'b.jpg'));
      assert.isFalse(isSelected(FA, 'c.jpg'));
      assert.isFalse(isSelected(FA, 'd.jpg'));
    });

    it('works regardless of click direction (later then earlier)', () => {
      toggleSelection(FA, 'c.jpg'); // anchor @ c
      shiftToggleSelection({ folderKey: FA, filename: 'a.jpg' }, ordered);
      assert.isTrue(isSelected(FA, 'a.jpg'));
      assert.isTrue(isSelected(FA, 'b.jpg'));
      assert.isTrue(isSelected(FA, 'c.jpg'));
      assert.isFalse(isSelected(FA, 'd.jpg'));
    });
  });
});
