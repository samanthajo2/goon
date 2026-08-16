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

import React from 'react';
import Modal from '../../lib/ui/modal.js';

export type VirtualFolderChoice = { id: string; name: string };

type Props = {
  count: number;
  folders: VirtualFolderChoice[];
  onPick: (id: string) => void;
  onCreate: (name: string) => void;
  onCancel: () => void;
  parent?: HTMLElement;
};

// Modal to add the current selection to an existing virtual folder or a new one.
export default function VirtualFolderPicker({ count, folders, onPick, onCreate, onCancel, parent }: Props): React.ReactElement {
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');

  const create = (): void => {
    const name = newName.trim();
    if (name) onCreate(name);
  };

  return (
    <Modal parent={parent}>
      <div className="dialog virtual-folder-picker">
        <div className="msg">Add {count} item{count === 1 ? '' : 's'} to a virtual folder</div>
        <div className="vf-list">
          {folders.length === 0 && (
            <div className="vf-empty">No virtual folders yet.</div>
          )}
          {folders.map(f => (
            <button type="button" key={f.id} className="vf-item" onClick={() => onPick(f.id)}>{f.name}</button>
          ))}
        </div>
        {creating ? (
          <div className="vf-new">
            <input
              autoFocus
              type="text"
              placeholder="Virtual folder name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') create();
                else if (e.key === 'Escape') onCancel();
              }}
            />
            <button type="button" onClick={create} disabled={!newName.trim()}>Create</button>
          </div>
        ) : (
          <button type="button" className="vf-new-button" onClick={() => setCreating(true)}>New Virtual Folder…</button>
        )}
        <div className="options">
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
