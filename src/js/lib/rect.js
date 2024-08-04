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

function right(rect) {
  return rect.x + rect.width;
}

function bottom(rect) {
  return rect.y + rect.height;
}

function contains(rect, x, y) {
  return x >= rect.x && x < right(rect) &&
         y >= rect.y && y < bottom(rect);
}

function intersect(rect1, rect2) {
  return !(empty(rect1) ||
           empty(rect2) ||
           right(rect1) <= rect2.x ||
           right(rect2) <= rect1.x ||
           bottom(rect1) <= rect2.y ||
           bottom(rect2) <= rect1.y);
}

// doesn't handle rects with width or height < 0
function intersection(rect1, ...rects) {
  const rect = {...rect1};
  for (const other of [...rects]) {
    const rectRight = right(rect);
    const otherRight = right(other);
    const rectBottom = bottom(rect);
    const otherBottom = bottom(other);
    const newLeft = Math.max(rect.x, other.x);
    const newTop = Math.max(rect.y, other.y);
    const newRight = Math.min(rectRight, otherRight);
    const newBottom = Math.min(rectBottom, otherBottom);
    rect.x = newLeft;
    rect.y = newTop;
    rect.width = newRight - newLeft;
    rect.height = newBottom - newTop;
  }
  return rect;
}

// doesn't handle rects with width or height <= 0
function union(rect1, ...rects) {
  const rect = {...rect1};
  for (const other of [...rects]) {
    const rectRight = right(rect);
    const otherRight = right(other);
    const newRight = Math.max(rectRight, otherRight);
    const rectBottom = bottom(rect);
    const otherBottom = bottom(other);
    const newBottom = Math.max(rectBottom, otherBottom);
    rect.x = Math.min(rect.x, other.x);
    rect.y = Math.min(rect.y, other.y);
    rect.width = newRight - rect.x;
    rect.height = newBottom - rect.y;
  }
  return rect;
}

function empty(rect) {
  return rect.width <= 0 || rect.height <= 0;
}

export {
  bottom,
  contains,
  empty,
  right,
  intersect,
  intersection,
  union,
};
