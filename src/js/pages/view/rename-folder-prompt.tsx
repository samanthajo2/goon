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

import React from 'react';
import Modal from '../../lib/ui/modal.js';

// Path separators (and `:`, which is a separator on some systems and illegal in
// names on others) are stripped so a rename can never turn into a move.
const g_illegalRE = /[/\\:]/g;
export function sanitizeFolderName(name: string): string {
  return name.replace(g_illegalRE, '');
}

type Props = {
  currentName: string;
  isVirtual: boolean;
  error: string;             // populated when the thumber rejects the rename
  onRename: (newName: string) => void;
  onCancel: () => void;
  parent?: HTMLElement;
};

export default function RenameFolderPrompt({
  currentName, isVirtual, error, onRename, onCancel, parent,
}: Props): React.ReactElement {
  const [name, setName] = React.useState(currentName);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const trimmed = name.trim();
  const canRename = trimmed.length > 0 && trimmed !== currentName;

  // Focus + select the name on open. autoFocus is unreliable inside the modal
  // portal, so drive it explicitly once mounted.
  React.useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, []);

  const commit = (): void => {
    if (canRename) onRename(trimmed);
  };

  return (
    <Modal parent={parent}>
      <div className="dialog rename-folder-prompt">
        <div className="msg">Rename {isVirtual ? 'virtual folder' : 'folder'}</div>
        {error && <div className="vf-error">{error}</div>}
        <div className="vf-new">
          <input
            ref={inputRef}
            type="text"
            value={name}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setName(sanitizeFolderName(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') onCancel();
            }}
          />
        </div>
        <div className="options">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={commit} disabled={!canRename}>Rename</button>
        </div>
      </div>
    </Modal>
  );
}
