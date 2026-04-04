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

import EventEmitter from 'node:events';

// An element that can be subscribed to — either a DOM EventTarget, a
// Node.js EventEmitter, or any duck-typed emitter with on/removeListener.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Listenable = EventTarget | EventEmitter | { on(e: string, h: (...a: any[]) => void): void; removeListener(e: string, h: (...a: any[]) => void): void; };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ListenerArgs = [string, ...any[]];

type ListenerEntry = {
  elem: Listenable;
  args: ListenerArgs;
};

// Duck-type rather than instanceof so subclasses and objects from different
// module copies all work correctly.
function isEmitterLike(elem: Listenable): elem is EventEmitter {
  return typeof (elem as EventEmitter).on === 'function' &&
         typeof (elem as EventEmitter).removeListener === 'function';
}

function addListener(elem: Listenable, eventName: string, handler: (...a: unknown[]) => void, ...rest: unknown[]): void {
  if (isEmitterLike(elem)) {
    elem.on(eventName, handler);
  } else {
    (elem as EventTarget).addEventListener(eventName, handler as EventListenerOrEventListenerObject, ...(rest as [AddEventListenerOptions?]));
  }
}

function removeListener(elem: Listenable, eventName: string, handler: (...a: unknown[]) => void, ...rest: unknown[]): void {
  if (isEmitterLike(elem)) {
    elem.removeListener(eventName, handler);
  } else {
    (elem as EventTarget).removeEventListener(eventName, handler as EventListenerOrEventListenerObject, ...(rest as [EventListenerOptions?]));
  }
}

// Tracks event subscriptions so they can all be torn down at once.
// Returns numeric IDs from on() for individual removal via remove().
export default class ListenerManager {
  private _listeners: Record<number, ListenerEntry> = {};
  private _nextId = 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(elem: Listenable, eventName: string, handler: (...a: any[]) => void, ...rest: unknown[]): number {
    addListener(elem, eventName, handler, ...rest);
    const id = this._nextId++;
    this._listeners[id] = { elem, args: [eventName, handler, ...rest] };
    return id;
  }

  remove(id: number): void {
    const listener = this._listeners[id];
    if (listener) {
      delete this._listeners[id];
      const [eventName, handler, ...rest] = listener.args;
      removeListener(listener.elem, eventName, handler, ...rest);
    }
  }

  removeAll(): void {
    const old = this._listeners;
    this._listeners = {};
    for (const listener of Object.values(old)) {
      const [eventName, handler, ...rest] = listener.args;
      removeListener(listener.elem, eventName, handler, ...rest);
    }
  }
}
