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

import { describe, it } from '../../lib/test/mocha.js';
import { assert } from 'chai';
import { computeKeyConflicts } from './key-conflicts.js';
import type { KeyConfig } from './default-prefs.js';

const k = (accelerator: string, action: string): KeyConfig =>
  ({ accelerator, action } as KeyConfig);

describe('computeKeyConflicts', () => {
  it('reports no conflicts for distinct bindings', () => {
    const result = computeKeyConflicts([k('R', 'resetZoom'), k('L', 'setLoop')]);
    assert.deepEqual(result, [[], []]);
  });

  it('flags both sides of an exact duplicate and names the other binding', () => {
    const result = computeKeyConflicts([k('R', 'resetZoom'), k('R', 'rotate')]);
    assert.lengthOf(result[0], 1, 'first binding has one conflict');
    assert.lengthOf(result[1], 1, 'second binding has one conflict');
    assert.match(result[0][0], /Rotate/, 'names the other action');
    assert.match(result[1][0], /Reset Zoom/, 'names the other action');
  });

  it('flags BOTH the standalone modifier and the binding that uses it', () => {
    // The real case: Shift bound alone (gotoPrev) vs CommandOrControl+Shift+= (zoomIn).
    const cfg = [
      k('Shift', 'gotoPrev'),
      k('CommandOrControl+Shift+=', 'zoomIn'),
    ];
    const result = computeKeyConflicts(cfg);
    assert.lengthOf(result[0], 1, 'standalone Shift is flagged (the missing second marker)');
    assert.lengthOf(result[1], 1, 'the Shift+= binding is flagged');
    assert.match(result[0][0], /Zoom In/, 'Shift row names the zoomIn binding');
    assert.match(result[1][0], /Previous Item/, 'zoomIn row names the standalone-Shift binding');
  });

  it('does not treat CommandOrControl as a standalone Control conflict', () => {
    // 'Control' inside 'CommandOrControl' is not a "+Control+" usage, so a standalone
    // Control binding must NOT flag CommandOrControl+= .
    const cfg = [
      k('Control', 'gotoNext'),
      k('CommandOrControl+=', 'zoomIn'),
    ];
    const result = computeKeyConflicts(cfg);
    assert.deepEqual(result, [[], []]);
  });

  it('ignores empty accelerators', () => {
    const result = computeKeyConflicts([k('', 'noop'), k('', 'noop')]);
    assert.deepEqual(result, [[], []]);
  });
});
