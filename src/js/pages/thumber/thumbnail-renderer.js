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

export default class ThumbnailRenderer {
  constructor(ctx) {
    this._ctx = ctx;
  }
  makeThumbnail(elem, elemWidth, elemHeight, orientation, maxWidth) {
    // orientation
    //
    // 1 top left side       norm
    // 2 top right side      hflip
    // 3 bottom right side   hflip & vflip
    // 4 bottom left side    vflip
    // 5 left side top       rot90 xflip
    // 6 right side top      rot270
    // 7 right side bottom   rot270 xflip
    // 8 left side bottom    rot90

    // NOTE: The confusing part is the data is stored
    // differently such that doing the rotations below
    // is not how to get them to work :(

    //   1        2       3      4         5            6           7          8
    //
    // 888888  888888      88  88      8888888888  88                  88  8888888888
    // 88          88      88  88      88  88      88  88          88  88      88  88
    // 8888      8888    8888  8888    88          8888888888  8888888888          88
    // 88          88      88  88
    // 88          88  888888  888888

    const ctx = this._ctx;

    orientation = orientation ? orientation : 1;
    const swap = (orientation - 1) & 0x4;  // eslint-disable-line no-bitwise
    const exifWidth  = swap ? elemHeight : elemWidth;
    const exifHeight = swap ? elemWidth : elemHeight;

    const imageWidth = maxWidth;
    const imageHeight = exifHeight * imageWidth / exifWidth | 0;

    const drawWidth  = swap ? imageHeight : imageWidth;
    const drawHeight = swap ? imageWidth : imageHeight;

    ctx.canvas.width = imageWidth;
    ctx.canvas.height = imageHeight;
    ctx.save();

    switch (orientation) {
      default:
        break;
      case 2:
        // horizontal flip
        ctx.translate(imageWidth, 0);
        ctx.scale(-1, 1);
        break;
      case 3:
        // 180° rotate left
        ctx.translate(imageWidth, imageHeight);
        ctx.rotate(Math.PI);
        break;
      case 4:
        // vertical flip
        ctx.translate(0, imageHeight);
        ctx.scale(1, -1);
        break;
      case 5:
        // vertical flip + 90 rotate right
        ctx.rotate(0.5 * Math.PI);
        ctx.scale(1, -1);
        break;
      case 6:
        // 90° rotate right
        ctx.rotate(0.5 * Math.PI);
        ctx.translate(0, -drawHeight);
        break;
      case 7:
        // horizontal flip + 90 rotate right
        ctx.rotate(0.5 * Math.PI);
        ctx.translate(drawWidth, -drawHeight);
        ctx.scale(-1, 1);
        break;
      case 8:
        // 90° rotate left
        ctx.rotate(-0.5 * Math.PI);
        ctx.translate(-drawWidth, 0);
        break;
    }

    ctx.drawImage(elem, 0, 0, drawWidth, drawHeight);
    ctx.restore();

    return ctx.canvas;
  }
}
