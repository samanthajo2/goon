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

import electron from 'electron';  // eslint-disable-line
import * as rect from './rect';

function adjustDimension(innerBounds, outerBounds, axis, dim) {
  const dispMax = outerBounds[axis] + outerBounds[dim];
  const winMax = innerBounds[axis] + innerBounds[dim];
  if (winMax > dispMax) {
    innerBounds[axis] -= winMax - dispMax;
  }
  if (innerBounds[axis] < outerBounds[axis]) {
    innerBounds[axis] += outerBounds[axis] - innerBounds[axis];
  }
  if (innerBounds[dim] > outerBounds[dim]) {
    innerBounds[dim] = outerBounds[dim];
  }
}

function putWindowOnNearestDisplay(winBounds) {
  const dispBounds = electron.screen.getDisplayMatching(winBounds).bounds;
  adjustDimension(winBounds, dispBounds, 'x', 'width');
  adjustDimension(winBounds, dispBounds, 'y', 'height');
  const perfectFit = winBounds.x === dispBounds.x &&
                     winBounds.y === dispBounds.y &&
                     winBounds.width === dispBounds.width &&
                     winBounds.height === dispBounds.height;
  return perfectFit;
}

function isTitlebarOnAtLeastOneDisplay(winBounds) {
  // should this be OS specific?
  const screen = electron.screen;
  const titleHeight = screen.getMenuBarHeight ? screen.getMenuBarHeight() : 20;
  const titleMinIntersectionWidth = 40;
  const titleMinIntersectionHeight = titleHeight;
  const displays = screen.getAllDisplays();

  const titleBounds = {
    x: winBounds.x,
    y: winBounds.y,
    width: winBounds.width,
    height: titleHeight,
  };
  for (const display of displays) {
    const dispBounds = display.bounds;
    const intersection = rect.intersection(dispBounds, titleBounds);
    if (!rect.empty(intersection)) {
      if (intersection.width >= titleMinIntersectionWidth &&
          intersection.height >= titleMinIntersectionHeight) {
        return true;
      }
    }
  }
  return false;
}

export {
  isTitlebarOnAtLeastOneDisplay,
  putWindowOnNearestDisplay,
};
