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

import path from 'path';
import {assert} from 'chai';
import * as utils from './utils';

function prepPaths(paths) {
  return paths.map((name) => path.normalize(path.resolve(name)));
}

describe('utils', () => {
  describe('removeChildFolders', () => {
    it('passes unrelated folders', () => {
      const result = utils.removeChildFolders(['a/a', 'b/b', 'c/c']);
      assert.deepEqual(result, prepPaths(['a/a', 'b/b', 'c/c']));
    });

    it('removes same folders', () => {
      const result = utils.removeChildFolders(['a/a', 'b/b', 'a/a']);
      assert.deepEqual(result, prepPaths(['a/a', 'b/b']));
    });

    it('removes same folders after normalizing', () => {
      const result1 = utils.removeChildFolders(['a/a', 'b/b', 'a/a/c/..']);
      assert.deepEqual(result1, prepPaths(['a/a', 'b/b']));
      const result2 = utils.removeChildFolders(['a/a/c/..', 'b/b', 'a/a']);
      assert.deepEqual(result2, prepPaths(['a/a', 'b/b']));
      const result3 = utils.removeChildFolders(['a/a/c/..', 'b/b', 'a/../a/a']);
      assert.deepEqual(result3, prepPaths(['a/a', 'b/b']));
    });

    it('removes children', () => {
      const result1 = utils.removeChildFolders(['a/a', 'b/b', 'a/a/c']);
      assert.deepEqual(result1, prepPaths(['a/a', 'b/b']));
      const result2 = utils.removeChildFolders(['a/a/c', 'b/b', 'a/a']);
      assert.deepEqual(result2, prepPaths(['a/a', 'b/b']));
    });
  });
});
