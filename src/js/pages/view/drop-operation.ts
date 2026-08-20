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

// The drag-and-drop behavior matrix. Given the kind of folder the items came from,
// the kind they're dropped on, and whether the copy modifier (Cmd/Ctrl) is held,
// decide what happens — and what the alternate is (for the move/copy toggle in the
// confirmation).
//
//   native  -> native            = move   (alt: copy)
//   native  -> native  (+mod)    = copy   (alt: move)
//   native  -> archive           = error
//   native  -> virtual           = add
//   archive -> archive           = error
//   archive -> native            = copy
//   archive -> virtual           = add
//   virtual -> native            = copy
//   virtual -> archive           = error
//   virtual -> virtual           = move   (alt: add — remove link from src, add to dst)
//   virtual -> virtual (+mod)    = add    (alt: move)

export type FolderKind = 'native' | 'archive' | 'virtual';
export type DropOp = 'move' | 'copy' | 'add' | 'error';

export type DropDecision = {
  op: DropOp;
  // The other op the user can switch to in the confirmation (undefined if none).
  alt?: DropOp;
  // Present when op === 'error'.
  reason?: string;
};

export function computeDropOperation(source: FolderKind, dest: FolderKind, copyModifier: boolean): DropDecision {
  if (dest === 'archive') {
    return { op: 'error', reason: 'Can’t drop into an archive.' };
  }
  switch (source) {
    case 'native':
      if (dest === 'native') {
        return copyModifier ? { op: 'copy', alt: 'move' } : { op: 'move', alt: 'copy' };
      }
      // dest === 'virtual'
      return { op: 'add' };
    case 'archive':
      if (dest === 'native') {
        return { op: 'copy' }; // can't move out of an archive
      }
      // dest === 'virtual'
      return { op: 'add' };
    case 'virtual':
      if (dest === 'native') {
        return { op: 'copy' }; // referenced real file copied out
      }
      // dest === 'virtual'
      return copyModifier ? { op: 'add', alt: 'move' } : { op: 'move', alt: 'add' };
    default:
      return { op: 'error', reason: 'Unknown source.' };
  }
}
