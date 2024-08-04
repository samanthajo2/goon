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

import sinon from 'sinon';  // eslint-disable-line

function makePublicPromise() {
  let resolve;
  let reject;
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

function emitSpy(msg) {
  const spy = sinon.spy();

  let waitResolve;
  function wait() {
    if (waitResolve) {
      throw new Error('already waiting');
    }
    return new Promise((resolve) => {
      waitResolve = resolve;
    });
  }

  const fn = function emitSpyHelper(...args) {
    if (msg) {
      console.log('emitSpy:', msg, ...args);
    }
    spy(...args);
    if (waitResolve) {
      if (msg) {
        console.log('emitSpy:', msg, 'resolving');
      }
      const fn = waitResolve;
      waitResolve = undefined;
      fn();
    }
  };
  fn.wait = wait;
  fn.spy = spy;
  return fn;
}

export {
  emitSpy,
  makePublicPromise,
};
