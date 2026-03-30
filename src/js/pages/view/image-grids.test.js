/*
Copyright 2024 SamanthaJo

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import { describe, it } from '../../lib/test/mocha';
import { assert } from 'chai';
import { findAnchorThumbnail, computeThumbScrollTop } from './image-grids';

// The pixel height of a folder's header bar (must match g_folderHeaderHeight in image-grids.jsx)
const HEADER = 30;

// Build the `folders` array shape expected by findAnchorThumbnail / computeThumbScrollTop.
// Each entry: { folder: { files: [{info: {thumbnail: {width, height}}}] } }
function makeFolder(thumbs) {
  return {
    folder: {
      files: thumbs.map(({w, h}) => ({info: {thumbnail: {width: w, height: h}}})),
    },
  };
}

// Identity zoom (thumbnailZoom = 1): zoom(v) === v
function identity(v) { return v; }

// Single-column options: minColumnWidth >= width forces exactly one column.
// padding=4 → drawWidth = width - padding, columnOffset = padding/2 = 2.
function singleColOpts(width) {
  return {padding: 4, minColumnWidth: width};
}

// Two-column options: minColumnWidth = width/2 → exactly two columns.
function twoColOpts(width) {
  return {padding: 4, minColumnWidth: width / 2};
}

describe('findAnchorThumbnail', () => {
  it('returns null when folders array is empty', () => {
    const anchor = findAnchorThumbnail([], 'columns', 200, identity, singleColOpts(200), 100);
    assert.isNull(anchor);
  });

  it('returns null when scrollTop is beyond all content', () => {
    // ColumnManager.height = drawHeight (single file, no padding subtracted at end when only 1 item)
    // Actually: height = max(paddedHeight - padding, 0) = max(104-4, 0) = 100
    const folders = [makeFolder([{w: 196, h: 100}])];
    const totalHeight = HEADER + 100;  // 130
    const anchor = findAnchorThumbnail(folders, 'columns', 200, identity, singleColOpts(200), totalHeight + 50);
    assert.isNull(anchor);
  });

  it('anchors to the first file when scrollTop=0', () => {
    const folders = [makeFolder([{w: 196, h: 100}, {w: 196, h: 100}])];
    const anchor = findAnchorThumbnail(folders, 'columns', 200, identity, singleColOpts(200), 0);
    assert.deepEqual(anchor, {folderIndex: 0, fileIndex: 0});
  });

  it('anchors to the first file when scrollTop equals the header height (top of grid)', () => {
    const folders = [makeFolder([{w: 196, h: 100}, {w: 196, h: 100}, {w: 196, h: 100}])];
    // scrollTop = HEADER → relScrollTop = 0, first file at y=0 qualifies
    const anchor = findAnchorThumbnail(folders, 'columns', 200, identity, singleColOpts(200), HEADER);
    assert.deepEqual(anchor, {folderIndex: 0, fileIndex: 0});
  });

  it('anchors to the second file when scrollTop is exactly at its top edge', () => {
    // Single column, width=200, padding=4 → drawWidth=196
    // Files: 196×100 → scale=1, drawHeight=100, paddedHeight=104
    // File 0: y=0, file 1: y=104
    // scrollTop = HEADER + 104 → relScrollTop=104, file 1 exactly at viewport top
    const folders = [makeFolder([{w: 196, h: 100}, {w: 196, h: 100}, {w: 196, h: 100}])];
    const scrollTop = HEADER + 104;
    const anchor = findAnchorThumbnail(folders, 'columns', 200, identity, singleColOpts(200), scrollTop);
    assert.deepEqual(anchor, {folderIndex: 0, fileIndex: 1});
  });

  it('anchors into the correct folder in a multi-folder layout', () => {
    // Folder 0: 2 files 196×100 → height=204. Folder total = HEADER+204=234.
    // Folder 1: 2 files. Starts at 234.
    // scrollTop = 234 + HEADER → relScrollTop=0, file 0 of folder 1.
    const folders = [
      makeFolder([{w: 196, h: 100}, {w: 196, h: 100}]),
      makeFolder([{w: 196, h: 100}, {w: 196, h: 100}]),
    ];
    const folder0Height = 204;  // 2 files: max(208-4, 104) = 204
    const scrollTop = HEADER + folder0Height + HEADER;  // = 264
    const anchor = findAnchorThumbnail(folders, 'columns', 200, identity, singleColOpts(200), scrollTop);
    assert.deepEqual(anchor, {folderIndex: 1, fileIndex: 0});
  });

  it('handles non-monotonic y-values in a two-column layout', () => {
    // Two columns: files are placed in shortest column first.
    // width=400, minColumnWidth=200, padding=4 → 2 columns, columnWidth=200, drawWidth=196
    // Files 196×100 each: file0→col0(y=0), file1→col1(y=0), file2→col0(y=104)
    // scrollTop = HEADER → relScrollTop=0: all three files have y≥-1, min y is 0 → file 0
    const width = 400;
    const folders = [makeFolder([{w: 196, h: 100}, {w: 196, h: 100}, {w: 196, h: 100}])];
    const scrollTop = HEADER;
    const anchor = findAnchorThumbnail(folders, 'columns', width, identity, twoColOpts(width), scrollTop);
    assert.deepEqual(anchor, {folderIndex: 0, fileIndex: 0});
  });

  it('skips file 1 in second column when scrollTop is past the first row in a two-column layout', () => {
    // width=400, 2 columns, files 196×100.
    // file0→col0(y=0), file1→col1(y=0), file2→col0(y=104)
    // scrollTop = HEADER + 104 → relScrollTop=104: files 0 and 1 at y=0 do not qualify,
    // file 2 at y=104 qualifies. Should return {fileIndex:2}.
    const width = 400;
    const folders = [makeFolder([{w: 196, h: 100}, {w: 196, h: 100}, {w: 196, h: 100}])];
    const scrollTop = HEADER + 104;
    const anchor = findAnchorThumbnail(folders, 'columns', width, identity, twoColOpts(width), scrollTop);
    assert.deepEqual(anchor, {folderIndex: 0, fileIndex: 2});
  });

  it('uses 1px snap tolerance to tolerate browser scrollTop rounding', () => {
    // Fractional thumbnail height causes fractional y positions.
    // computeThumbScrollTop returns 134.5; browser rounds up to 135.07.
    // Without tolerance: relScrollTop=105.07, file1 at y=104.5 < 105.07 → misses.
    // With 1px tolerance: 104.5 >= 104.07 → correctly anchors to file 1.
    const folders = [makeFolder([{w: 196, h: 100.5}, {w: 196, h: 100.5}, {w: 196, h: 100.5}])];
    // File 0: y=0, file 1: y=104.5 (drawHeight=100.5, paddedHeight=104.5)
    const scrollTopRoundedUp = HEADER + 105.07;  // browser rounded up from 134.5
    const anchor = findAnchorThumbnail(folders, 'columns', 200, identity, singleColOpts(200), scrollTopRoundedUp);
    assert.deepEqual(anchor, {folderIndex: 0, fileIndex: 1});
  });
});

describe('computeThumbScrollTop', () => {
  it('returns HEADER for the first file in a single-folder layout', () => {
    const folders = [makeFolder([{w: 196, h: 100}, {w: 196, h: 100}])];
    const top = computeThumbScrollTop(folders, 'columns', 200, identity, singleColOpts(200), 0, 0);
    assert.strictEqual(top, HEADER);
  });

  it('returns HEADER + file1.y for the second file', () => {
    // file 1 y = 104 (drawHeight=100, paddedHeight=104)
    const folders = [makeFolder([{w: 196, h: 100}, {w: 196, h: 100}, {w: 196, h: 100}])];
    const top = computeThumbScrollTop(folders, 'columns', 200, identity, singleColOpts(200), 0, 1);
    assert.strictEqual(top, HEADER + 104);
  });

  it('accounts for all preceding folders', () => {
    // Folder 0: 2 files, height=204. Folder total = HEADER+204=234.
    // Folder 1: file 0 at y=0.
    const folders = [
      makeFolder([{w: 196, h: 100}, {w: 196, h: 100}]),
      makeFolder([{w: 196, h: 100}, {w: 196, h: 100}]),
    ];
    const folder0Total = HEADER + 204;
    const top = computeThumbScrollTop(folders, 'columns', 200, identity, singleColOpts(200), 1, 0);
    assert.strictEqual(top, folder0Total + HEADER);
  });

  it('handles two-column layout with non-monotonic y-values', () => {
    // width=400, 2 columns, files 196×100.
    // file0→y=0, file1→y=0, file2→y=104
    const width = 400;
    const folders = [makeFolder([{w: 196, h: 100}, {w: 196, h: 100}, {w: 196, h: 100}])];
    const top = computeThumbScrollTop(folders, 'columns', width, identity, twoColOpts(width), 0, 2);
    assert.strictEqual(top, HEADER + 104);
  });
});

describe('findAnchorThumbnail / computeThumbScrollTop round-trip', () => {
  it('round-trips correctly for single-column layout', () => {
    const folders = [makeFolder([{w: 196, h: 100}, {w: 196, h: 100}, {w: 196, h: 100}])];
    const opts = singleColOpts(200);

    for (let fileIndex = 0; fileIndex < 3; fileIndex++) {
      const scrollTop = computeThumbScrollTop(folders, 'columns', 200, identity, opts, 0, fileIndex);
      const anchor = findAnchorThumbnail(folders, 'columns', 200, identity, opts, scrollTop);
      assert.deepEqual(anchor, {folderIndex: 0, fileIndex}, `round-trip for fileIndex ${fileIndex}`);
    }
  });

  it('round-trips correctly across multiple folders', () => {
    const folders = [
      makeFolder([{w: 196, h: 100}, {w: 196, h: 100}]),
      makeFolder([{w: 196, h: 100}, {w: 196, h: 100}]),
      makeFolder([{w: 196, h: 100}, {w: 196, h: 100}]),
    ];
    const opts = singleColOpts(200);

    for (let folderIndex = 0; folderIndex < 3; folderIndex++) {
      for (let fileIndex = 0; fileIndex < 2; fileIndex++) {
        const scrollTop = computeThumbScrollTop(folders, 'columns', 200, identity, opts, folderIndex, fileIndex);
        const anchor = findAnchorThumbnail(folders, 'columns', 200, identity, opts, scrollTop);
        assert.deepEqual(anchor, {folderIndex, fileIndex},
          `round-trip failed for folder ${folderIndex}, file ${fileIndex}`);
      }
    }
  });

  it('round-trips correctly for two-column layout', () => {
    const width = 400;
    // 4 files: col0 gets 0,2; col1 gets 1,3
    // file0→y=0, file1→y=0, file2→y=104, file3→y=104
    const folders = [makeFolder([
      {w: 196, h: 100}, {w: 196, h: 100},
      {w: 196, h: 100}, {w: 196, h: 100},
    ])];
    const opts = twoColOpts(width);

    // file0 and file1 both at y=0, so anchor always resolves to fileIndex=0
    // (the first one with that minimum y). Test files 0 and 2 (which are the
    // "first in their row" from each column's perspective).
    const top0 = computeThumbScrollTop(folders, 'columns', width, identity, opts, 0, 0);
    assert.strictEqual(top0, HEADER + 0);
    const anchor0 = findAnchorThumbnail(folders, 'columns', width, identity, opts, top0);
    assert.deepEqual(anchor0, {folderIndex: 0, fileIndex: 0});

    const top2 = computeThumbScrollTop(folders, 'columns', width, identity, opts, 0, 2);
    assert.strictEqual(top2, HEADER + 104);
    const anchor2 = findAnchorThumbnail(folders, 'columns', width, identity, opts, top2);
    assert.deepEqual(anchor2, {folderIndex: 0, fileIndex: 2});
  });
});
