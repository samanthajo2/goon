
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
 * Let's you go through keys by string
 * const kh = new KeyHelper({a: 123, b: 456, c: 789});
 * let k = kh.first();  // k = 'a'
 * console.log(kh.value(k)); // 123
 * k = kh.next(k); // k = 'b'
 * k = kh.next(k); // k = 'c'
 * k = kh.next(k); // k = 'a'
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default class KeyHelper<T extends Record<string, any>> {
  _collection: T;
  _keys: (keyof T)[];
  constructor(collection: T) {
    this._collection = collection;
    this._keys = Object.keys(collection) as (keyof T)[];
  }
  first(): keyof T {
    return this._keys[0];
  }
  value<K extends keyof T>(key: K): T[K] {
    return this._collection[key];
  }
  next<K extends keyof T>(key: K): keyof T {
    const ndx = (this._keys.indexOf(key) + 1) % this._keys.length;
    return this._keys[ndx];
  }
}
