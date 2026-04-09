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

import { describe, it } from './test/mocha.js';
import { assert } from 'chai';
import EventEmitter from 'node:events';
import ListenerManager from './listener-manager.js';

describe('ListenerManager', () => {
  describe('on / EventEmitter', () => {
    it('receives events after on()', () => {
      const mgr = new ListenerManager();
      const emitter = new EventEmitter();
      const received: number[] = [];

      mgr.on(emitter, 'data', (v: number) => received.push(v));
      emitter.emit('data', 1);
      emitter.emit('data', 2);

      assert.deepEqual(received, [1, 2]);
    });
  });

  describe('remove', () => {
    it('stops receiving events after remove(id)', () => {
      const mgr = new ListenerManager();
      const emitter = new EventEmitter();
      const received: number[] = [];

      const id = mgr.on(emitter, 'data', (v: number) => received.push(v));
      emitter.emit('data', 1);
      mgr.remove(id);
      emitter.emit('data', 2);

      assert.deepEqual(received, [1]);
    });

    it('remove() is a no-op for an unknown id', () => {
      const mgr = new ListenerManager();
      assert.doesNotThrow(() => mgr.remove(9999));
    });

    it('remove() does not affect other listeners', () => {
      const mgr = new ListenerManager();
      const emitter = new EventEmitter();
      const a: number[] = [];
      const b: number[] = [];

      const idA = mgr.on(emitter, 'data', (v: number) => a.push(v));
      mgr.on(emitter, 'data', (v: number) => b.push(v));

      emitter.emit('data', 1);
      mgr.remove(idA);
      emitter.emit('data', 2);

      assert.deepEqual(a, [1]);
      assert.deepEqual(b, [1, 2]);
    });
  });

  describe('removeAll', () => {
    it('stops all listeners at once', () => {
      const mgr = new ListenerManager();
      const emitterA = new EventEmitter();
      const emitterB = new EventEmitter();
      const a: number[] = [];
      const b: number[] = [];

      mgr.on(emitterA, 'ping', (v: number) => a.push(v));
      mgr.on(emitterB, 'ping', (v: number) => b.push(v));

      emitterA.emit('ping', 1);
      emitterB.emit('ping', 1);
      mgr.removeAll();
      emitterA.emit('ping', 2);
      emitterB.emit('ping', 2);

      assert.deepEqual(a, [1]);
      assert.deepEqual(b, [1]);
    });

    it('removeAll() on an empty manager does not throw', () => {
      const mgr = new ListenerManager();
      assert.doesNotThrow(() => mgr.removeAll());
    });

    it('removeAll() can be called twice without error', () => {
      const mgr = new ListenerManager();
      const emitter = new EventEmitter();
      mgr.on(emitter, 'x', () => {});
      mgr.removeAll();
      assert.doesNotThrow(() => mgr.removeAll());
    });
  });
});
