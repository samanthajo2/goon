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

import {assert} from 'chai';
import {defaultPrefs, getPrefs} from './default-prefs';

describe('default-prefs', () => {
  it('returns defaults', () => {
    assert.deepEqual(getPrefs(), defaultPrefs);
  });

  it('fills in defaults', () => {
    assert.deepEqual(getPrefs({}), defaultPrefs);
  });

  it('fills missng defaults', () => {
    assert.deepEqual(getPrefs({
      misc: {
        stepForwardDuration: defaultPrefs.misc.stepForwardDuration,
      }
    }), defaultPrefs);
    assert.deepEqual(getPrefs({
      slideshowDuration: {
        image: defaultPrefs.slideshowDuration.image,
      }
    }), defaultPrefs);
  });

  it('does not override existing values', () => {
    const prefs = getPrefs({
      misc: {
        stepForwardDuration: 123,
      }
    });
    assert.strictEqual(prefs.misc.stepForwardDuration, 123);
    assert.strictEqual(prefs.misc.stepBackwardDuration, defaultPrefs.misc.stepBackwardDuration);
  });
});
