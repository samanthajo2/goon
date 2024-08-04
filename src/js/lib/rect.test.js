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
import * as r from './rect';

describe('rect', () => {
  it('right', () => {
    const rect = { x: 3, width: 7, };
    assert.strictEqual(10, r.right(rect));
  });

  it('bottom', () => {
    const rect = { y: 3, height: 7, };
    assert.strictEqual(10, r.bottom(rect));
  });

  it('contains', () => {
    const rect = {
      x: 4, y: 3, width: 10, height: 7,
    };
    assert.isOk(r.contains(rect, 4, 3));
    assert.isOk(r.contains(rect, 5, 4));
    assert.isOk(r.contains(rect, 4 + 9, 3 + 6));
    assert.isNotOk(r.contains(rect, 4 + 10, 3 + 6));
    assert.isNotOk(r.contains(rect, 4 + 9, 3 + 7));
    assert.isNotOk(r.contains(rect, 3, 3));
    assert.isNotOk(r.contains(rect, 4, 2));
  });

  it('empty', () => {
    const notEmptyRect1 = {
      width: 10, height: 7,
    };
    const notEmptyRect2 = {
      width: 1, height: 1,
    };
    const emptyRect1 = {
      width: 0, height: 1,
    };
    const emptyRect2 = {
      width: 1, height: 0,
    };
    const emptyRect3 = {
      width: 0, height: 0,
    };
    const emptyRect4 = {
      width: -1, height: 10,
    };
    const emptyRect5 = {
      width: 10, height: -1,
    };
    assert.isNotOk(r.empty(notEmptyRect1));
    assert.isNotOk(r.empty(notEmptyRect2));
    assert.isOk(r.empty(emptyRect1));
    assert.isOk(r.empty(emptyRect2));
    assert.isOk(r.empty(emptyRect3));
    assert.isOk(r.empty(emptyRect4));
    assert.isOk(r.empty(emptyRect5));
  });

  it('intersect', () => {
    const rect = {
      x: 5, y: 3, width: 10, height: 7,
    };
    const intersectInsideRect = {
      x: 6, y: 4, width: 2, height: 2,
    };
    const intersectOutsideRect = {
      x: 4, y: 2, width: 20, height: 20,
    };
    const intersectLeftRect = {
      x: 4, y: 4, width: 2, height: 2,
    };
    const intersectRightRect = {
      x: 14, y: 4, width: 1, height: 2,
    };
    const intersectTopRect = {
      x: 6, y: 1, width: 2, height: 4,
    };
    const intersectBottomRect = {
      x: 6, y: 5, width: 2, height: 20,
    };
    const offLeftRect = {
      x: 1, y: 4, width: 4, height: 2,
    };
    const offRightRect = {
      x: 15, y: 4, width: 2, height: 2,
    };
    const offTopRect = {
      x: 6, y: 1, width: 4, height: 2,
    };
    const offBottomRect = {
      x: 6, y: 10, width: 4, height: 2,
    };
    const emptyRect1 = {
      x: 6, y: 4, width: 0, height: 2,
    };
    const emptyRect2 = {
      x: 6, y: 4, width: 2, height: 0,
    };
    assert.isOk(r.intersect(rect, intersectInsideRect), 'inside');
    assert.isOk(r.intersect(rect, intersectOutsideRect), 'outside');
    assert.isOk(r.intersect(rect, intersectLeftRect), 'inLeft');
    assert.isOk(r.intersect(rect, intersectRightRect), 'inRight');
    assert.isOk(r.intersect(rect, intersectTopRect), 'inTop');
    assert.isOk(r.intersect(rect, intersectBottomRect), 'inBottom');
    assert.isNotOk(r.intersect(rect, offLeftRect), 'offLeft');
    assert.isNotOk(r.intersect(rect, offRightRect), 'offRight');
    assert.isNotOk(r.intersect(rect, offTopRect), 'offTop');
    assert.isNotOk(r.intersect(rect, offBottomRect), 'offBottom');
    assert.isNotOk(r.intersect(rect, emptyRect1), 'empty1');
    assert.isNotOk(r.intersect(rect, emptyRect2), 'empty2');
  });

  it('intersection', () => {
    const rect1 = {
      x: 5, y: 3, width: 10, height: 7,
    };
    const rect2 = {
      x: 4, y: 2, width: 5, height: 6,
    };
    const rect3 = {
      x: 6, y: 5, width: 5, height: 6,
    };
    const expect12 = {
      x: 5, y: 3, width: 4, height: 5,
    };
    const expect123 = {
      x: 6, y: 5, width: 3, height: 3,
    };
    assert.deepEqual(r.intersection(rect1, rect2), expect12);
    assert.deepEqual(r.intersection(rect1, rect2, rect3), expect123);
  });

  it('union', () => {
    const rect1 = {
      x: 5, y: 3, width: 10, height: 7,
    };
    const rect2 = {
      x: 4, y: 2, width: 5, height: 6,
    };
    const rect3 = {
      x: 6, y: 5, width: 5, height: 4,
    };
    const rect4 = {
      x: 100, y: 500, width: 5, height: 6,
    };
    const expect12 = {
      x: 4, y: 2, width: 11, height: 8,
    };
    const expect123 = {
      x: 4, y: 2, width: 11, height: 8,
    };
    const expect1234 = {
      x: 4, y: 2, width: 101, height: 504,
    };
    assert.deepEqual(r.union(rect1, rect2), expect12, '12');
    assert.deepEqual(r.union(rect1, rect2, rect3), expect123, '123');
    assert.deepEqual(r.union(rect1, rect2, rect3, rect4), expect1234, '1234');
  });
});
