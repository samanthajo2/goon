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

export default class ForwardableEventDispatcher {
  constructor() {
    this._handlers = {};
  }
  setForward(forward) {
    this._forwarder = forward;
    if (forward) {
      forward._setBackward(this);
    }
  }
  _setBackward(backward) {
    this._backward = backward;
  }
  on(name, fn) {
    let handlers = this._handlers[name];
    if (!handlers) {
      handlers = [];
      this._handlers[name] = handlers;
    }
    handlers.push(fn);
  }
  removeListener(name, fn) {
    const handlers = this._handlers[name];
    if (handlers) {
      const ndx = handlers.indexOf(fn);
      if (ndx >= 0) {
        handlers.splice(ndx, 1);
        if (handlers.length === 0) {
          delete this._handlers[name];
        }
      }
    }
  }
  dispatch(forwardableEvent, ...args) {
    // this is effectively the focus for this subtree (go to the leaf)
    if (this._forwarder) {
      this._forwarder.dispatch(forwardableEvent, ...args);
    }
    if (!forwardableEvent.propagationStopped) {
      this._dispatchBackward(forwardableEvent, ...args);
    }
  }
  _dispatchBackward(forwardableEvent, ...args) {
    this._callHandlers(forwardableEvent, ...args);
    if (!forwardableEvent.propagationStopped) {
      if (this._backward) {
        this._backward._dispatchBackward(forwardableEvent, ...args);
      } else {
        forwardableEvent.stopPropagation();
      }
    }
  }
  _callHandlers(forwardableEvent, ...args) {
    const handlers = this._handlers[forwardableEvent.name];
    if (handlers) {
      if (handlers.length === 1) {
        handlers[0](forwardableEvent, ...args);
      } else {
        const h = [...handlers];  // make copy because handle might add/remove handlers
        for (let i = 0; i < h.length && !forwardableEvent.propagationStopped; ++i) {
          const handler = h[i];
          handler(forwardableEvent, ...args);
        }
      }
    }
  }
}
