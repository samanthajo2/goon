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
import createLimitedResourceManager from './limited-resource-manager.js';
import type { LimitedResourceManager } from './limited-resource-manager.js';
import wait from './wait.js';

describe('limitedResourceManager', () => {
  class TestResource {
    private _v: number;
    constructor(v: number) {
      this._v = v;
    }
    test(): number {
      return this._v;
    }
  }

  type Pair = { resource: TestResource; release: () => void };

  it('manages 1', async () => {
    const expected = 123;
    const mgr: LimitedResourceManager<TestResource> = createLimitedResourceManager([new TestResource(expected)]);

    let onePair: Pair | undefined;
    let twoPair: Pair | undefined;

    mgr().then((pair) => {
      onePair = pair;
    });
    mgr().then((pair) => {
      twoPair = pair;
    });

    await wait();

    assert.isOk(onePair, 'one acquired');
    assert.isNotOk(twoPair, 'two is pending');
    assert.strictEqual(onePair!.resource.test(), expected, 'can use resource');

    onePair!.release();

    // can not use released resource
    assert.throws(() => { onePair!.resource.test(); });

    await wait();

    assert.isOk(twoPair, 'two acquired');
    assert.strictEqual(twoPair!.resource.test(), expected, 'can use resource');

    twoPair!.release();

    // can not use released resource
    assert.throws(() => { twoPair!.resource.test(); });
  });

  it('manages N', async () => {
    const numResources = 10;
    const resources: TestResource[] = [];
    for (let i = 0; i < numResources; ++i) {
      resources.push(new TestResource(i));
    }
    const mgr: LimitedResourceManager<TestResource> = createLimitedResourceManager(resources);

    const pairs: Array<Pair | false> = [];

    function get(ndx: number): void {
      pairs[ndx] = false;
      mgr().then((pair) => {
        pairs[ndx] = pair;
      });
    }

    const numToTest = numResources * 2;
    for (let i = 0; i < numToTest; ++i) {
      get(i);
    }

    await wait();

    for (let i = 0; i <= numToTest; ++i) {
      const lastDone = Math.min(numToTest, i + numResources);
      for (let j = i; j < lastDone; ++j) {
        assert.isOk(pairs[j]);
        assert.strictEqual((pairs[j] as Pair).resource.test(), j % numResources, 'can use resource');
      }
      for (let j = i + numResources; j < numToTest; ++j) {
        assert.isNotOk(pairs[j]);
      }

      (pairs[i % numResources] as Pair).release();
      assert.throws(accessResourceFn(pairs[i % numResources]));

      await wait();
    }

    // After release(), pair.resource is a revoked proxy — accessing any property throws.
    // We pass the pair object (not pair.resource) so that calling .test() on it throws
    // because there is no .test method on the pair wrapper itself.
    function accessResourceFn(pair: Pair | false): () => unknown {
      return () => (pair as unknown as { test(): number }).test();
    }
  });
});
