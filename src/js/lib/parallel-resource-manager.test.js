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
import createParallelResourceManager from './parallel-resource-manager';
import wait from './wait';

describe('parallelResourceManager', () => {
  it('manages 1', async () => {
    const mgr = createParallelResourceManager(1);

    let oneRelease;
    let twoRelease;

    mgr().then((release) => {
      oneRelease = release;
    });
    mgr().then((release) => {
      twoRelease = release;
    });

    await wait();

    assert.isOk(oneRelease, 'one acquired');
    assert.isNotOk(twoRelease, 'two is pending');

    oneRelease();

    await wait();

    assert.isOk(twoRelease, 'two acquired');

    twoRelease();
  });

  it('manages N', async () => {
    const numParallel = 3;
    const mgr = createParallelResourceManager(numParallel);

    const numToTest = 10;
    const releases = [];

    function get(ndx) {
      releases[ndx] = false;
      mgr().then((release) => {
        releases[ndx] = release;
      });
    }

    for (let i = 0; i < numToTest; ++i) {
      get(i);
    }

    await wait();

    for (let i = 0; i <= numToTest; ++i) {
      const lastDone = Math.min(numToTest, i + numParallel);
      for (let j = 0; j < lastDone; ++j) {
        assert.isOk(releases[j]);
      }
      for (let j = i + numParallel; j < numToTest; ++j) {
        assert.isNotOk(releases[j]);
      }

      if (i < releases.length) {
        releases[i]();
      }

      await wait();
    }
  });
});
