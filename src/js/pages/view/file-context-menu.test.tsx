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

// Render-level tests for the file context menu's delete/remove label — it must name
// the entry correctly: "Delete <path>" in a real folder, but "Remove <composite>"
// (the entry, not the archive) when the item sits inside a virtual folder.

import React from 'react';
import { describe, it, afterEach } from '../../lib/test/mocha.js';
import { assert } from 'chai';
import { cleanup, screen } from '@testing-library/react';
import { renderWithContext } from '../../test-support/render.js';
import FileContextMenu from './file-context-menu.js';
import { showMenu, hideMenu } from '../../lib/ui/context-menu.js';
import type { DBFileInfo } from './folder-db.js';

afterEach(() => { hideMenu(); cleanup(); });

function file(filename: string, archiveName?: string): DBFileInfo {
  return { filename, archiveName } as unknown as DBFileInfo;
}

function renderMenu(f: DBFileInfo, folderKey: string) {
  showMenu({ id: 'fileContextMenu', position: { x: 0, y: 0 } });
  return renderWithContext(<FileContextMenu file={f} folderKey={folderKey} rotateMode={0} />);
}

describe('FileContextMenu (component)', () => {
  it('labels a real-folder file "Delete <path>"', () => {
    renderMenu(file('/vol/a.jpg'), '/vol');
    assert.ok(screen.getByText('Delete /vol/a.jpg'));
  });

  it('labels an archive entry inside a virtual folder "Remove <composite path>"', () => {
    renderMenu(file('/vol/pics.zip/img.jpg', '/vol/pics.zip'), 'vfolder:xyz');
    // Not "Delete", and names the entry — not the archive file.
    assert.ok(screen.getByText('Remove /vol/pics.zip/img.jpg'));
    assert.isNull(screen.queryByText('Delete /vol/pics.zip'), 'must not offer to delete the archive');
  });
});
