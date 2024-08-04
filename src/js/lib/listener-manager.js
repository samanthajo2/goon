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

export default function ListenerManager() {
  let listeners = {};
  let nextId = 1;

  // Returns an id for the listener. This is easier IMO than
  // the normal remove listener which requires the same arguments as addListener
  this.on = (elem, ...args) => {
    (elem.addEventListener || elem.on || elem.addListener).call(elem, ...args);
    const id = nextId++;
    listeners[id] = {
      elem: elem,
      args: args,
    };
    if (args.length < 2) {
      throw new Error('too few args');
    }
    return id;
  };

  this.remove = (id) => {
    const listener = listeners[id];
    if (listener) {
      delete listener[id];
      const elem = listener.elem;
      (elem.removeEventListener || elem.removeListener).call(elem, ...listener.args);
    }
  };

  this.removeAll = () => {
    const old = listeners;
    listeners = {};
    Object.keys(old).forEach((id) => {
      const listener = old[id];
      if (listener.args < 2) {
        throw new Error('too few args');
      }
      const elem = listener.elem;
      (elem.removeEventListener || elem.removeListener).call(elem, ...listener.args);
    });
  };
}
