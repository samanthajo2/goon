/*
Copyright 2024 SamanthaJo

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

import { describe, it } from './test/mocha.js';
import { assert } from 'chai';
import { displayBasename } from './path-helpers.js';

describe('path-helpers', () => {
  describe('displayBasename', () => {
    it('takes the last segment of a posix path', () => {
      assert.equal(displayBasename('/a/b/track.mp3'), 'track.mp3');
    });

    it('takes the last segment of a windows path', () => {
      assert.equal(displayBasename('C:\\a\\b\\track.mp3'), 'track.mp3');
    });

    it('strips the separator archive entries use', () => {
      // archive.ts rewrites '/' to '|' in entry names, so a plain basename
      // would caption this 'zip-test|track.mp3'.
      assert.equal(displayBasename('zip-test|track.mp3'), 'track.mp3');
    });

    it('strips a nested archive entry down to the file', () => {
      assert.equal(displayBasename('outer|inner|track.mp3'), 'track.mp3');
    });

    it('handles an archive entry inside a real path', () => {
      assert.equal(displayBasename('/a/b.zip/zip-test|track.mp3'), 'track.mp3');
    });

    it('leaves a bare name alone', () => {
      assert.equal(displayBasename('track.mp3'), 'track.mp3');
    });

    it('keeps names that merely contain a bar late', () => {
      assert.equal(displayBasename('a|'), '');
    });

    it('handles an empty string', () => {
      assert.equal(displayBasename(''), '');
    });
  });
});
