/*
Copyright 2026 SamanthaJo

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

// A pair of connected in-memory streams that mimic window-ipc's ChannelStream
// (on / removeListener / send / close). `send` on one end asynchronously delivers to
// the other end's listeners, modeling the async nature of real IPC. Used by the
// integration harness to wire the view side to the thumber side with no Electron.

import EventEmitter from 'node:events';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void;

export type LoopbackStream = {
  on: (event: string, fn: Listener) => void;
  removeListener: (event: string, fn: Listener) => void;
  send: (event: string, ...args: unknown[]) => void;
  close: () => void;
};

function makeEnd(self: EventEmitter, other: EventEmitter): LoopbackStream {
  return {
    on: (event, fn) => { self.on(event, fn); },
    removeListener: (event, fn) => { self.removeListener(event, fn); },
    // Deliver asynchronously (like IPC) so a send during a handler doesn't reenter.
    send: (event, ...args) => { queueMicrotask(() => other.emit(event, ...args)); },
    close: () => { self.removeAllListeners(); },
  };
}

export function makeChannelPair(): { view: LoopbackStream; thumber: LoopbackStream } {
  const viewEmitter = new EventEmitter();
  const thumberEmitter = new EventEmitter();
  viewEmitter.setMaxListeners(0);
  thumberEmitter.setMaxListeners(0);
  return {
    view: makeEnd(viewEmitter, thumberEmitter),
    thumber: makeEnd(thumberEmitter, viewEmitter),
  };
}
