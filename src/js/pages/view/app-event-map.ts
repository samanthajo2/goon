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

import type { DBFileInfo } from './folder-db';
import type { FolderContextInfo } from './viewer-events';

// Extra args (beyond the leading ForwardableEvent) for each event name.
// ActionEvent and TimeUpdateEvent carry their payload on the event object
// itself, so their extra-args tuple is empty.
export type AppEventMap = {
  // Dispatched as ActionEvent; payload is on event.action
  action: [];

  // Context menu triggers — domEvent is on forwardableEvent.domEvent
  fileContextMenu: [fileInfo: DBFileInfo];
  folderContextMenu: [folderInfo: FolderContextInfo];

  // File operations (all bubble up to app.tsx handlers)
  refreshFolder: [folderPath: string];
  deleteFile: [fileInfo: DBFileInfo];
  deleteFolder: [folderInfo: FolderContextInfo];
  copyFile: [fileInfo: DBFileInfo];
  copyFolder: [folderInfo: FolderContextInfo];
  showFileInfo: [fileInfo: DBFileInfo];

  // Viewer navigation
  view: [fileInfo: DBFileInfo];
  hide: [];
  releaseMedia: [];
  gotoNext: [];
  gotoPrev: [];
  setCurrentNdx: [ndx: number];

  // Folder-list navigation
  goToImage: [imageNdx: number, folderNdx: number];
  scrollToImage: [imageNdx: number, folderNdx: number];
  scrollToImagePropagate: [imageNdx: number];
  scrollFolderViewToFile: [folderPath: string];

  // Media playback — payload carried on TimeUpdateEvent
  timeupdate: [];

  // Misc
  playAll: [];
};
