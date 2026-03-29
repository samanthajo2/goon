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

// This class is used to manage
// a few limited resources (passed in)
// User's can get one by calling manager.get which returns
// a promise. The promise resolves to an object with the release function and the resource.
// You must call release when done with the resource
type AcquireResult<T> = {
  release: () => void;
  resource: T;
};
type AcquireFN<T> = (result: AcquireResult<T>) => void;
export type LimitedResourceManager<T> = () => Promise<AcquireResult<T>>;

export default function createLimitedResourceManager<T extends object>(_resources: T[]): LimitedResourceManager<T> {
  const resources = _resources.slice();
  const pendingRequests: AcquireFN<T>[] = [];

  function releaseResource(resource: T) {
    resources.push(resource);
    // don't want these to get nested
    process.nextTick(processRequests);
  }

  function createProxy(resource: T) {
    let released = false;
    const { proxy, revoke } = Proxy.revocable<T>(resource, {
      get(target, prop, _receiver) {
        const value = Reflect.get(target, prop, target);
        if (typeof value === 'function') {
          return value.bind(target);
        }
        return value;
      },
    });
    function release() {
      if (!released) {
        released = true;
        revoke();
        releaseResource(resource);
      }
    }
    return {proxy, release};
  }

  function processRequests() {
    while (pendingRequests.length && resources.length) {
      const resolve = pendingRequests.shift()!;
      const resource = resources.shift()!;
      const { proxy, release } = createProxy(resource);
      resolve({ release: release, resource: proxy });
    }
  }

  return function get() {
    const p = new Promise<AcquireResult<T>>((resolve /* , reject */) => {
      pendingRequests.push(resolve);
    });
    processRequests();
    return p;
  };
}
