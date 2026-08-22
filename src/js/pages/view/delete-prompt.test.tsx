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

// Render-level tests for DeletePrompt's per-item classification: a mixed
// real-file + virtual-folder selection must read honestly (trash vs remove) rather
// than claiming to trash everything.

import React from 'react';
import { describe, it, afterEach } from '../../lib/test/mocha.js';
import { assert } from 'chai';
import sinon from 'sinon';
import { cleanup, fireEvent } from '@testing-library/react';
import { renderWithContext } from '../../test-support/render.js';
import DeletePrompt, { DeleteItem } from './delete-prompt.js';
import type { FileInfo } from '../../lib/fileinfo.js';

afterEach(() => cleanup());

// Minimal DeleteItem; thumbStyle tolerates a missing thumbnail.
function item(filename: string, folderKey: string, archiveName?: string): DeleteItem {
  return { filename, folderKey, info: { archiveName } as unknown as FileInfo };
}

const msgText = () => document.querySelector('.delete-prompt .msg')?.textContent ?? '';
const opTags = () => [...document.querySelectorAll('.delete-prompt .drop-op-tag')].map(e => e.textContent);
const okButton = () =>
  [...document.querySelectorAll('.delete-prompt .options button')].find(b => b.textContent === 'Delete') as HTMLButtonElement;

describe('DeletePrompt (component)', () => {
  it('a uniform real-file delete reads as a plain permanent delete, no per-item tags', () => {
    renderWithContext(
      <DeletePrompt
        okay="Delete"
        items={[item('/vol/a.jpg', '/vol'), item('/vol/b.jpg', '/vol')]}
        onOkay={() => {}}
        onCancel={() => {}}
      />,
    );
    assert.match(msgText(), /Permanently delete 2 files\? Deleting files cannot be undone\./);
    assert.deepEqual(opTags(), [], 'no per-item op badges for a uniform list');
  });

  it('a mixed real + virtual selection reads honestly and tags each item', () => {
    renderWithContext(
      <DeletePrompt
        okay="Delete"
        items={[item('/vol/a.jpg', '/vol'), item('/vol/a.jpg', 'vfolder:xyz')]}
        onOkay={() => {}}
        onCancel={() => {}}
      />,
    );
    assert.match(msgText(), /Permanently delete 1 file and remove 1 item from a virtual folder\?/);
    assert.match(msgText(), /Deleting files cannot be undone\./);
    assert.deepEqual(opTags(), ['Trash', 'Remove'], 'per-item badges show the real op');
  });

  it('OK stays enabled and fires onOkay when there is something actionable', () => {
    const onOkay = sinon.spy();
    renderWithContext(
      <DeletePrompt
        okay="Delete"
        items={[item('/vol/a.jpg', '/vol')]}
        onOkay={onOkay}
        onCancel={() => {}}
      />,
    );
    const ok = okButton();
    assert.isFalse(ok.disabled);
    fireEvent.click(ok);
    assert.isTrue(onOkay.calledOnce);
  });
});
