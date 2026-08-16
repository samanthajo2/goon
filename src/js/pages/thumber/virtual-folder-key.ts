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

// A virtual folder appears in the UI under a synthetic folder key (rather than a
// real filesystem path). This is the one place the scheme is defined so the thumber
// (which produces the key) and the view (which routes delete/add/remove on it) agree.
// The colon makes it unambiguous vs. a real absolute path on every platform.

const VIRTUAL_FOLDER_PREFIX = 'vfolder:';

export function makeVirtualFolderKey(id: string): string {
  return `${VIRTUAL_FOLDER_PREFIX}${id}`;
}

export function isVirtualFolderKey(key: string): boolean {
  return key.startsWith(VIRTUAL_FOLDER_PREFIX);
}

export function virtualFolderIdFromKey(key: string): string | undefined {
  return isVirtualFolderKey(key) ? key.slice(VIRTUAL_FOLDER_PREFIX.length) : undefined;
}
