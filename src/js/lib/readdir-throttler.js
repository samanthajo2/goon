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

import createParallelResourceManager from './parallel-resource-manager';
import wait from './wait';

export default function createThrottledReaddir(originalReaddirFn, maxParallelReaddirs = 10, throttleTime = 0) {
  function readdirP(filepath, options) {
    return new Promise((resolve, reject) => {
      originalReaddirFn(filepath, options, (err, fileList) => {
        if (err) {
          reject(err);
        } else {
          resolve(fileList);
        }
      });
    });
  }
  const readdirManager = createParallelResourceManager(maxParallelReaddirs);
  async function readdirHelper(filepath, options, callback) {
    if (!callback) {
      callback = options;
      options = undefined;
    }
    const release = await readdirManager();
    if (throttleTime) {
      await wait(throttleTime);
    }
    let fileList;
    try {
      fileList = await readdirP(filepath, options);
    } catch (e) {
      callback(e);
      callback = () => {};
    }
    process.nextTick(release);
    process.nextTick(() => {
      callback(undefined, fileList);
    });
  }

  return readdirHelper;
}
