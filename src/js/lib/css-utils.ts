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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function exists(a: any) {
  return !!a;
}

class CSSArray {
  _classes: string[];
  constructor(...args: (string | undefined)[]) {
    this._classes = [...args].filter(exists) as string[];
  }
  add(...classNames: (string | undefined)[]) {
    this._classes = [...this._classes, ...[...classNames].filter(exists)] as string[];
    return this;
  }
  addIf(cond: boolean, ...classNames: string[]) {
    if (cond) {
      this.add(...[...classNames].filter(exists));
    }
    return this;
  }
  remove(...classNames: string[]) {
    const names = new Set(classNames);
    this._classes = this._classes.filter(n => !names.has(n));
    return this;
  }
  removeIf(cond: boolean, ...classNames: string[]) {
    if (cond) {
      this.remove(...classNames);
    }
    return this;
  }
  toString() {
    return this._classes.join(' ');
  }
}

function cssArray(...args: (string | undefined)[]) {
  return new CSSArray(...args);
}

function hsl(h: number, s: number, l: number) {
  return `hsl(${h * 360 | 0}, ${s * 100 | 0}%, ${l * 100 | 0}%)`;
}

export {
  CSSArray,
  cssArray,
  hsl,
};
