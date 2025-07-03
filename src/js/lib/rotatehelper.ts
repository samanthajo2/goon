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

type RotateMode = {
  className: string;
  axis: 'X' | 'Y';
  xMult: number;
  yMult: number;
}

const rotateModes: RotateMode[] = [
  { className: 'deg0',   axis: 'X', xMult:  1, yMult:  1 },
  { className: 'deg90',  axis: 'Y', xMult:  1, yMult: -1 },
  { className: 'deg180', axis: 'X', xMult: -1, yMult: -1 },
  { className: 'deg270', axis: 'Y', xMult: -1, yMult:  1 },
];


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRotatedXY(e: any, fieldName: string, rotateMode: number): { x: number; y: number } {
  const ri = rotateModes[rotateMode];
  const xAxis = ri.axis;
  const yAxis = xAxis === 'X' ? 'Y' : 'X';
  return {
    x: e[fieldName + xAxis] * ri.xMult,
    y: e[fieldName + yAxis] * ri.yMult,
  };
}

type OrientationInfo = {
  rotation: number;
  scale: [number, number];
}

const orientationInfo: OrientationInfo[] = [
  { rotation:   0, scale: [ 1,  1] }, // 1
  { rotation:   0, scale: [-1,  1] }, // 2
  { rotation:   0, scale: [-1, -1] }, // 3
  { rotation:   0, scale: [ 1, -1] }, // 4
  { rotation: 270, scale: [-1,  1] }, // 5
  { rotation: 270, scale: [-1, -1] }, // 6
  { rotation:  90, scale: [-1,  1] }, // 7
  { rotation:  90, scale: [-1, -1] }, // 8
];

type ItemWithDimensions ={
  width: number;
  height: number;
}

function getOrientationInfo(item: ItemWithDimensions, orientation: number): { width: number; height: number; rotation: number; scale: [number, number] } {
  const info = orientationInfo[(orientation || 1) - 1];
  return {
    width: info.rotation ? item.height : item.width,
    height: info.rotation ? item.width : item.height,
    ...info,
  };
}

export {
  rotateModes,
  getRotatedXY,
  getOrientationInfo,
};
