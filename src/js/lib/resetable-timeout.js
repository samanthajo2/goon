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

import bind from './bind';
import debug from './debug';

let resetTimeoutId = 0;

// * ResetableTimeout
//   Like `setTimeout` except you can call `reset` to extend the timeout

export default class ResetableTimeout {
  constructor(fn, timeoutInMS, thresholdInMS) {
    this._fn = fn;
    this._id = ++resetTimeoutId;
    this._logger = debug('ResetableTimeout', this._id);
    this._thresholdInMS = thresholdInMS || timeoutInMS / 4;
    this._timeOfLastRealReset = 0;
    bind(
      this,
      '_handleTimeout',
    );
    this.reset(timeoutInMS);
  }
  reset(timeoutInMS) {
    if (timeoutInMS !== undefined) {
      this._timeoutInMS = timeoutInMS;
    }
    const now = Date.now();
    const timeSinceLastReset = this._timeOfLastRealReset - now;
    if (timeoutInMS === undefined && this._timeoutId && timeSinceLastReset < this._thresholdInMS) {
      this._logger('timeout not reset');
      return;
    }
    this._logger('timeout reset');
    this._timeOfLastRealReset = now;
    this.cancel();
    this._timeoutId = setTimeout(this._handleTimeout, this._timeoutInMS);
  }
  cancel() {
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
    }
  }
  _handleTimeout() {
    this._logger('timeout triggered');
    this._timeoutId = undefined;
    this._fn();
  }
}

