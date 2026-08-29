/*
Copyright 2026 SamanthaJo

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

import { describe, it } from '../../lib/test/mocha.js';
import { assert } from 'chai';
import { computeMixGains, effectiveVolume } from './screen-recorder.js';

describe('screen-recorder', () => {
  describe('effectiveVolume', () => {
    const el = (volume: number, muted: boolean) =>
      ({ volume, muted }) as HTMLMediaElement;

    it('is the element volume when unmuted', () => {
      assert.equal(effectiveVolume(el(0.4, false)), 0.4);
    });

    it('is zero when muted, whatever the slider says', () => {
      // A muted-but-loud element must not set the normalization ceiling and
      // crush everything else down.
      assert.equal(effectiveVolume(el(1, true)), 0);
    });
  });

  describe('computeMixGains', () => {
    it('records a single video at full level regardless of its volume', () => {
      // The whole point: capturing one video turned down to 30% should not
      // produce a recording at 30%.
      assert.deepEqual(computeMixGains([0.3]), [1]);
      assert.deepEqual(computeMixGains([1]), [1]);
    });

    it('silences a video whose volume is zero', () => {
      assert.deepEqual(computeMixGains([0.8, 0]), [1, 0]);
    });

    it('keeps the relative balance between videos', () => {
      assert.deepEqual(computeMixGains([0.5, 0.25]), [1, 0.5]);
    });

    it('lifts a quiet set so the loudest sits at unity', () => {
      assert.deepEqual(computeMixGains([0.3, 0.3, 0.3]), [1, 1, 1]);
    });

    it('never exceeds unity on any single source', () => {
      for (const g of computeMixGains([0.2, 0.9, 0.05, 1])) {
        assert.isAtMost(g, 1);
        assert.isAtLeast(g, 0);
      }
    });

    it('stays silent rather than dividing by zero when everything is off', () => {
      assert.deepEqual(computeMixGains([0, 0]), [0, 0]);
    });

    it('handles an empty mix', () => {
      assert.deepEqual(computeMixGains([]), []);
    });
  });
});
