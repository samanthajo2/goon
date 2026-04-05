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
import type { GridMode } from './grid-modes';

// The pixel height of a folder's header bar (must match g_folderHeaderHeight in image-grids.tsx)
const HEADER = 30;

type ThumbDim = { w: number; h: number };

// Build the `folders` array shape expected by findAnchorThumbnail / computeThumbScrollTop.
function makeFolder(thumbs: ThumbDim[]) {
  return {
    folder: {
      files: thumbs.map(({ w, h }) => ({ info: { thumbnail: { width: w, height: h } } })),
    },
  };
}

// Identity zoom (thumbnailZoom = 1): zoom(v) === v
function identity(v: number): number { return v; }

// Single-column options: minColumnWidth >= width forces exactly one column.
function singleColOpts(width: number) {
  return { padding: 4, minColumnWidth: width };
}

// Two-column options: minColumnWidth = width/2 → exactly two columns.
function twoColOpts(width: number) {
  return { padding: 4, minColumnWidth: width / 2 };
}

const GRID_MODE: GridMode = 'columns';

describe('findAnchorThumbnail', () => {
  it('returns null when folders array is empty', () => {
    const anchor = findAnchorThumbnail([], GRID_MODE, 200, identity, singleColOpts(200), 100);
    assert.isNull(anchor);
  });

  it('returns null when scrollTop is beyond all content', () => {
    const folders = [makeFolder([{ w: 196, h: 100 }])];
    const totalHeight = HEADER + 100;
    const anchor = findAnchorThumbnail(folders as Parameters<typeof findAnchorThumbnail>[0], GRID_MODE, 200, identity, singleColOpts(200), totalHeight + 50);
    assert.isNull(anchor);
  });

  it('anchors to the first file when scrollTop=0', () => {
    const folders = [makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }])];
    const anchor = findAnchorThumbnail(folders as Parameters<typeof findAnchorThumbnail>[0], GRID_MODE, 200, identity, singleColOpts(200), 0);
    assert.deepEqual(anchor, { folderIndex: 0, fileIndex: 0 });
  });

  it('anchors to the first file when scrollTop equals the header height (top of grid)', () => {
    const folders = [makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }, { w: 196, h: 100 }])];
    const anchor = findAnchorThumbnail(folders as Parameters<typeof findAnchorThumbnail>[0], GRID_MODE, 200, identity, singleColOpts(200), HEADER);
    assert.deepEqual(anchor, { folderIndex: 0, fileIndex: 0 });
  });

  it('anchors to the second file when scrollTop is exactly at its top edge', () => {
    const folders = [makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }, { w: 196, h: 100 }])];
    const scrollTop = HEADER + 104;
    const anchor = findAnchorThumbnail(folders as Parameters<typeof findAnchorThumbnail>[0], GRID_MODE, 200, identity, singleColOpts(200), scrollTop);
    assert.deepEqual(anchor, { folderIndex: 0, fileIndex: 1 });
  });

  it('anchors into the correct folder in a multi-folder layout', () => {
    const folders = [
      makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }]),
      makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }]),
    ];
    const folder0Height = 204;
    const scrollTop = HEADER + folder0Height + HEADER;
    const anchor = findAnchorThumbnail(folders as Parameters<typeof findAnchorThumbnail>[0], GRID_MODE, 200, identity, singleColOpts(200), scrollTop);
    assert.deepEqual(anchor, { folderIndex: 1, fileIndex: 0 });
  });

  it('handles non-monotonic y-values in a two-column layout', () => {
    const width = 400;
    const folders = [makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }, { w: 196, h: 100 }])];
    const scrollTop = HEADER;
    const anchor = findAnchorThumbnail(folders as Parameters<typeof findAnchorThumbnail>[0], GRID_MODE, width, identity, twoColOpts(width), scrollTop);
    assert.deepEqual(anchor, { folderIndex: 0, fileIndex: 0 });
  });

  it('skips file 1 in second column when scrollTop is past the first row in a two-column layout', () => {
    const width = 400;
    const folders = [makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }, { w: 196, h: 100 }])];
    const scrollTop = HEADER + 104;
    const anchor = findAnchorThumbnail(folders as Parameters<typeof findAnchorThumbnail>[0], GRID_MODE, width, identity, twoColOpts(width), scrollTop);
    assert.deepEqual(anchor, { folderIndex: 0, fileIndex: 2 });
  });

  it('uses 1px snap tolerance to tolerate browser scrollTop rounding', () => {
    const folders = [makeFolder([{ w: 196, h: 100.5 }, { w: 196, h: 100.5 }, { w: 196, h: 100.5 }])];
    const scrollTopRoundedUp = HEADER + 105.07;
    const anchor = findAnchorThumbnail(folders as Parameters<typeof findAnchorThumbnail>[0], GRID_MODE, 200, identity, singleColOpts(200), scrollTopRoundedUp);
    assert.deepEqual(anchor, { folderIndex: 0, fileIndex: 1 });
  });
});

describe('computeThumbScrollTop', () => {
  it('returns HEADER for the first file in a single-folder layout', () => {
    const folders = [makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }])];
    const top = computeThumbScrollTop(folders as Parameters<typeof computeThumbScrollTop>[0], GRID_MODE, 200, identity, singleColOpts(200), 0, 0);
    assert.strictEqual(top, HEADER);
  });

  it('returns HEADER + file1.y for the second file', () => {
    const folders = [makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }, { w: 196, h: 100 }])];
    const top = computeThumbScrollTop(folders as Parameters<typeof computeThumbScrollTop>[0], GRID_MODE, 200, identity, singleColOpts(200), 0, 1);
    assert.strictEqual(top, HEADER + 104);
  });

  it('accounts for all preceding folders', () => {
    const folders = [
      makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }]),
      makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }]),
    ];
    const folder0Total = HEADER + 204;
    const top = computeThumbScrollTop(folders as Parameters<typeof computeThumbScrollTop>[0], GRID_MODE, 200, identity, singleColOpts(200), 1, 0);
    assert.strictEqual(top, folder0Total + HEADER);
  });

  it('handles two-column layout with non-monotonic y-values', () => {
    const width = 400;
    const folders = [makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }, { w: 196, h: 100 }])];
    const top = computeThumbScrollTop(folders as Parameters<typeof computeThumbScrollTop>[0], GRID_MODE, width, identity, twoColOpts(width), 0, 2);
    assert.strictEqual(top, HEADER + 104);
  });
});

describe('findAnchorThumbnail / computeThumbScrollTop round-trip', () => {
  it('round-trips correctly for single-column layout', () => {
    const folders = [makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }, { w: 196, h: 100 }])];
    const opts = singleColOpts(200);

    for (let fileIndex = 0; fileIndex < 3; fileIndex++) {
      const scrollTop = computeThumbScrollTop(folders as Parameters<typeof computeThumbScrollTop>[0], GRID_MODE, 200, identity, opts, 0, fileIndex);
      const anchor = findAnchorThumbnail(folders as Parameters<typeof findAnchorThumbnail>[0], GRID_MODE, 200, identity, opts, scrollTop);
      assert.deepEqual(anchor, { folderIndex: 0, fileIndex }, `round-trip for fileIndex ${fileIndex}`);
    }
  });

  it('round-trips correctly across multiple folders', () => {
    const folders = [
      makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }]),
      makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }]),
      makeFolder([{ w: 196, h: 100 }, { w: 196, h: 100 }]),
    ];
    const opts = singleColOpts(200);

    for (let folderIndex = 0; folderIndex < 3; folderIndex++) {
      for (let fileIndex = 0; fileIndex < 2; fileIndex++) {
        const scrollTop = computeThumbScrollTop(folders as Parameters<typeof computeThumbScrollTop>[0], GRID_MODE, 200, identity, opts, folderIndex, fileIndex);
        const anchor = findAnchorThumbnail(folders as Parameters<typeof findAnchorThumbnail>[0], GRID_MODE, 200, identity, opts, scrollTop);
        assert.deepEqual(anchor, { folderIndex, fileIndex },
          `round-trip failed for folder ${folderIndex}, file ${fileIndex}`);
      }
    }
  });

  it('round-trips correctly for two-column layout', () => {
    const width = 400;
    const folders = [makeFolder([
      { w: 196, h: 100 }, { w: 196, h: 100 },
      { w: 196, h: 100 }, { w: 196, h: 100 },
    ])];
    const opts = twoColOpts(width);

    const top0 = computeThumbScrollTop(folders as Parameters<typeof computeThumbScrollTop>[0], GRID_MODE, width, identity, opts, 0, 0);
    assert.strictEqual(top0, HEADER + 0);
    const anchor0 = findAnchorThumbnail(folders as Parameters<typeof findAnchorThumbnail>[0], GRID_MODE, width, identity, opts, top0);
    assert.deepEqual(anchor0, { folderIndex: 0, fileIndex: 0 });

    const top2 = computeThumbScrollTop(folders as Parameters<typeof computeThumbScrollTop>[0], GRID_MODE, width, identity, opts, 0, 2);
    assert.strictEqual(top2, HEADER + 104);
    const anchor2 = findAnchorThumbnail(folders as Parameters<typeof findAnchorThumbnail>[0], GRID_MODE, width, identity, opts, top2);
    assert.deepEqual(anchor2, { folderIndex: 0, fileIndex: 2 });
  });
});
