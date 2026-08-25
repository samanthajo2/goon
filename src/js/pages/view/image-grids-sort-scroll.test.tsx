/*
Copyright 2026 SamanthaJo

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

// Regression test for the sort-mode scroll bug: after changing the sort order, the
// grid must jump to the top AND cache the top as the restore position. Otherwise
// viewing an image and returning restores the pre-sort scroll (the grid remounts and
// replays a stale anchor), dropping the user many screens down. See ImageGrids
// componentDidUpdate's sortMode branch.

import React from 'react';
import { describe, it, afterEach } from '../../lib/test/mocha.js';
import { assert } from 'chai';
import { render, cleanup } from '@testing-library/react';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher.js';
import { AppContext, AppContextValue } from './contexts.js';
import ImageGrids from './image-grids.js';
import type { Platform } from '../../lib/platform.js';
import type { Preferences } from '../prefs/default-prefs.js';

afterEach(() => cleanup());

function emptyRoot() {
  return { folders: [], totalFiles: 0, indexFn: () => 0, sortFn: () => 0 };
}

function baseProps(sortMode: string, saveScrollTop: (s: number, a: unknown) => void) {
  return {
    gotoFolderNdx: -1,
    scrollTop: 0,
    initialAnchor: null,
    saveScrollTop,
    root: emptyRoot(),
    width: 800,
    options: { columnWidth: 200, padding: 4, maxSeekTime: 1 },
    winState: { gridMode: 'columns', thumbnailZoom: 1, showUI: 0, rotateMode: 0, sortMode },
    rotateMode: 0,
    setCurrentView: () => {},
    currentImageIndex: -1,
  };
}

function wrap(children: React.ReactNode) {
  const value: AppContextValue = {
    eventBus: new ForwardableEventDispatcher(),
    platform: { fileToUrl: (p: string) => p } as unknown as Platform,
    prefs: {} as Preferences,
  };
  return <AppContext value={value}>{children}</AppContext>;
}

describe('ImageGrids sort-mode scroll reset', () => {
  it('scrolls to top and caches (0, null) when the sort mode changes', () => {
    const saveCalls: Array<[number, unknown]> = [];
    const save = (s: number, a: unknown) => { saveCalls.push([s, a]); };

    const { rerender, container } = render(
      wrap(<ImageGrids {...(baseProps('sortPath', save) as unknown as React.ComponentProps<typeof ImageGrids>)} />),
    );

    // Simulate the user having scrolled the grid down.
    const grid = container.querySelector('.imagegrids') as HTMLElement;
    assert.ok(grid, 'grid element should render');
    grid.scrollTop = 5000;

    saveCalls.length = 0; // ignore any mount-time bookkeeping

    // Change only the sort mode — the same signal cycleSortMode produces.
    rerender(wrap(<ImageGrids {...(baseProps('newest', save) as unknown as React.ComponentProps<typeof ImageGrids>)} />));

    assert.strictEqual(grid.scrollTop, 0, 'grid should be scrolled back to the top');
    assert.deepEqual(
      saveCalls.at(-1),
      [0, null],
      'the cached scroll position/anchor should be reset to the top',
    );
  });

  it('does not reset the scroll when unrelated props change', () => {
    const saveCalls: Array<[number, unknown]> = [];
    const save = (s: number, a: unknown) => { saveCalls.push([s, a]); };

    const { rerender, container } = render(
      wrap(<ImageGrids {...(baseProps('sortPath', save) as unknown as React.ComponentProps<typeof ImageGrids>)} />),
    );
    const grid = container.querySelector('.imagegrids') as HTMLElement;
    grid.scrollTop = 5000;
    saveCalls.length = 0;

    // Re-render with the same sort mode (e.g. an unrelated winState field changed).
    const props = baseProps('sortPath', save);
    props.rotateMode = 1;
    rerender(wrap(<ImageGrids {...(props as unknown as React.ComponentProps<typeof ImageGrids>)} />));

    assert.strictEqual(grid.scrollTop, 5000, 'scroll must be left alone when sort is unchanged');
    assert.deepEqual(saveCalls, [], 'no forced save when sort is unchanged');
  });
});
