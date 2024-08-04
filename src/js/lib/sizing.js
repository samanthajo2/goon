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

/**
 * scale so height fits dest
 */
function fitHeight(srcWidth, srcHeight, dstWidth, dstHeight) {
  return {
    width: srcWidth * dstHeight / srcHeight | 0,
    height: dstHeight,
  };
}

/**
 * scale so width fits dest
 */
function fitWidth(srcWidth, srcHeight, dstWidth/* , dstHeight */) {
  return {
    width: dstWidth,
    height: srcHeight * dstWidth / srcWidth | 0,
  };
}

/**
 * leave as is
 */
function actualSize(srcWidth, srcHeight/* , dstWidth, dstHeight */) {
  return {
    width: srcWidth,
    height: srcHeight,
  };
}
/**
 * scale so the dest is entirely covered
 */
function cover(srcWidth, srcHeight, dstWidth, dstHeight) {
  const size = fitWidth(srcWidth, srcHeight, dstWidth, dstHeight);
  if (size.height < dstHeight) {
    return fitHeight(srcWidth, srcHeight, dstWidth, dstHeight);
  } else {
    return size;
  }
}

/**
 * scale so the dest is 100% in which ever dimension fits
 */
function stretch(srcWidth, srcHeight, dstWidth, dstHeight) {
  const size = fitWidth(srcWidth, srcHeight, dstWidth, dstHeight);
  if (size.height > dstHeight) {
    return fitHeight(srcWidth, srcHeight, dstWidth, dstHeight);
  } else {
    return size;
  }
}

/**
 * scale down if larger than dest
 */
function constrain(srcWidth, srcHeight, dstWidth, dstHeight) {
  if (srcWidth > dstWidth || srcHeight > dstHeight) {
    return stretch(srcWidth, srcHeight, dstWidth, dstHeight);
  } else {
    return actualSize(srcWidth, srcHeight, dstWidth, dstHeight);
  }
}


export {
  cover,
  stretch,
  constrain,
  fitHeight,
  fitWidth,
  actualSize,
};
