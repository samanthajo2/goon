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
import ActionListener from './action-listener.js';
import ActionEvent from './action-event.js';

describe('ActionListener', () => {
  it('routeAction emits on the correct ActionId', () => {
    const listener = new ActionListener();
    let received: ActionEvent | undefined;
    listener.on('zoomIn', (e: ActionEvent) => { received = e; });

    const event = new ActionEvent({ action: 'zoomIn' });
    listener.routeAction(event);

    assert.strictEqual(received, event);
  });

  it('routeAction does not emit on a different ActionId', () => {
    const listener = new ActionListener();
    let called = false;
    listener.on('zoomOut', () => { called = true; });

    listener.routeAction(new ActionEvent({ action: 'zoomIn' }));

    assert.isFalse(called);
  });

  it('routeAction forwards extra args to the handler', () => {
    const listener = new ActionListener();
    const extras: unknown[] = [];
    listener.on('rotate', (_e: ActionEvent, ...args: unknown[]) => { extras.push(...args); });

    const event = new ActionEvent({ action: 'rotate' });
    listener.routeAction(event, 'extra1', 42);

    assert.deepEqual(extras, ['extra1', 42]);
  });

  it('routeAction is bound and callable without a receiver', () => {
    const listener = new ActionListener();
    let called = false;
    listener.on('togglePlay', () => { called = true; });

    const { routeAction } = listener;
    routeAction(new ActionEvent({ action: 'togglePlay' }));

    assert.isTrue(called);
  });
});
