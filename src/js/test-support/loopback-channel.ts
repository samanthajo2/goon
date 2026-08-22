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

// Methods live on the prototype and use `this` — deliberately mirroring the real
// ChannelStream (an EventEmitter). This means extracting a method unbound
// (`const on = stream.on; on(...)`) throws here too, so the harness catches that
// class of bug instead of hiding it behind a pre-bound closure.
export class LoopbackStream {
  #self: EventEmitter;
  #other: EventEmitter;

  constructor(self: EventEmitter, other: EventEmitter) {
    this.#self = self;
    this.#other = other;
  }

  on(event: string, fn: Listener): void {
    this.#self.on(event, fn);
  }

  removeListener(event: string, fn: Listener): void {
    this.#self.removeListener(event, fn);
  }

  // Deliver asynchronously (like IPC) so a send during a handler doesn't reenter.
  send(event: string, ...args: unknown[]): void {
    const other = this.#other;
    queueMicrotask(() => other.emit(event, ...args));
  }

  close(): void {
    this.#self.removeAllListeners();
  }
}

export function makeChannelPair(): { view: LoopbackStream; thumber: LoopbackStream } {
  const viewEmitter = new EventEmitter();
  const thumberEmitter = new EventEmitter();
  viewEmitter.setMaxListeners(0);
  thumberEmitter.setMaxListeners(0);
  return {
    view: new LoopbackStream(viewEmitter, thumberEmitter),
    thumber: new LoopbackStream(thumberEmitter, viewEmitter),
  };
}
