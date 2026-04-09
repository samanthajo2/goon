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

import createParallelResourceManager from './parallel-resource-manager.js';
import wait from './wait.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReaddirCallback = (err: NodeJS.ErrnoException | null | undefined, fileList?: any[]) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OriginalReaddirFn = (filepath: string, options: any, callback: ReaddirCallback) => void;

export default function createThrottledReaddir(
  originalReaddirFn: OriginalReaddirFn,
  maxParallelReaddirs = 10,
  throttleTime = 0,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function readdirP(filepath: string, options: any): Promise<any[]> {
    return new Promise((resolve, reject) => {
      originalReaddirFn(filepath, options, (err, fileList) => {
        if (err) {
          reject(err);
        } else {
          resolve(fileList!);
        }
      });
    });
  }

  const readdirManager = createParallelResourceManager(maxParallelReaddirs);

  async function readdirHelper(
    filepath: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any | ReaddirCallback,
    callback?: ReaddirCallback,
  ): Promise<void> {
    if (!callback) {
      callback = options as ReaddirCallback;
      options = undefined;
    }
    const release = await readdirManager();
    if (throttleTime) {
      await wait(throttleTime);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fileList: any[] | undefined;
    try {
      fileList = await readdirP(filepath, options);
    } catch (e) {
      (callback as ReaddirCallback)(e as NodeJS.ErrnoException);
      callback = () => {};
    }
    process.nextTick(release);
    process.nextTick(() => {
      (callback as ReaddirCallback)(undefined, fileList);
    });
  }

  return readdirHelper;
}
