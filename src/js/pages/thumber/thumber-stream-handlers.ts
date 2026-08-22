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

// The message handlers the thumber attaches to each connected view stream, factored
// out of thumber.tsx so both the real thumber and the integration-test harness wire
// up the *same* handlers over a stream (real IPC vs. an in-process loopback). Only
// the per-connection bookkeeping (targets list, teardown) stays in thumber.tsx.

import path from 'node:path';
import type ThumbnailManager from './thumbnail-manager.js';
import type { VirtualFolderAddEntry } from './thumbnail-manager.js';
import { isVirtualFolderKey, virtualFolderIdFromKey } from './virtual-folder-key.js';

// The subset of a ChannelStream these handlers use.
export type HandlerStream = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on: (event: string, fn: (...args: any[]) => void) => void;
  send: (event: string, ...args: unknown[]) => void;
};

export type ThumberHandlerDeps = {
  thumbnailManager: ThumbnailManager;
  // Runs a main-process filesystem op (real ipcRenderer.invoke, or the harness's
  // in-memory equivalent).
  ipcInvoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  sendVirtualFolders: () => void;
  virtualFolderState: () => unknown;
  refreshFolders: () => void;
  // True if the path is an existing directory on disk (wraps fs.statSync).
  statIsDirectory: (p: string) => boolean;
  log: (...args: unknown[]) => void;
};

export function registerThumberStreamHandlers(stream: HandlerStream, deps: ThumberHandlerDeps): void {
  const { thumbnailManager: tm, ipcInvoke, sendVirtualFolders, virtualFolderState, refreshFolders, statIsDirectory, log } = deps;
  // Bind so `on` keeps its `this` — ChannelStream.on is a prototype (EventEmitter)
  // method; calling it unbound throws "Cannot read properties of undefined
  // (reading '_events')".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const on = stream.on.bind(stream) as (event: string, fn: (...args: any[]) => void) => void;

  // Create a new virtual folder with a unique "Untitled"/"Untitled N" name and tell
  // the view. Shared by the top-level "New Virtual Folder" command and the folder
  // context menu's "New Virtual Folder" (on an existing virtual folder).
  const createUniqueVirtualFolder = () => {
    const taken = new Set(tm.listVirtualFolders().map(f => f.name.trim().toLowerCase()));
    let name = 'Untitled';
    for (let i = 2; taken.has(name.toLowerCase()); ++i) name = `Untitled ${i}`;
    tm.createVirtualFolder(name);
    sendVirtualFolders();
  };

  on('refreshFolder', (folderName: string) => {
    tm.refreshFolder(folderName);
  });
  on('refreshFolders', () => {
    refreshFolders();
  });
  // Act on (folderKey, filename) entries. A `vfolder:` key removes the entry from
  // that virtual folder (the real file is untouched); a real key permanently deletes
  // the file (fs, via main) and proactively updates folder data so thumbnails
  // disappear without waiting for the watcher — which also drops it from any virtual
  // folders that referenced it. Acks `filesDeleted` so the view can clear its overlay.
  on('deleteEntries', async (entries: { folderKey: string; filename: string }[]) => {
    for (const { folderKey, filename } of entries) {
      if (isVirtualFolderKey(folderKey)) {
        const id = virtualFolderIdFromKey(folderKey);
        if (id) tm.removeFileFromVirtualFolder(id, filename);
      } else {
        try {
          await ipcInvoke('deleteFile', filename);
          tm.removeFile(filename);
        } catch (err) {
          log('deleteFile failed:', filename, err);
        }
      }
    }
    stream.send('filesDeleted', entries.map(e => e.filename));
  });
  // Delete a folder-like entry. Virtual folders delete themselves; otherwise a
  // directory is recursively removed and anything else (an archive is a single file)
  // is unlinked and proactively removed.
  on('deleteFolder', async (folderKey: string) => {
    if (isVirtualFolderKey(folderKey)) {
      const id = virtualFolderIdFromKey(folderKey);
      if (id) tm.deleteVirtualFolder(id);
      sendVirtualFolders();
      return;
    }
    try {
      if (statIsDirectory(folderKey)) {
        await ipcInvoke('deleteFolder', folderKey);
      } else {
        await ipcInvoke('deleteFile', folderKey);
        tm.removeFile(folderKey);
      }
    } catch (err) {
      log('deleteFolder failed:', folderKey, err);
    }
  });
  // Create a new folder. A virtual folder key makes a new uniquely-named virtual
  // folder; a native path makes an "Untitled" subdir, then refreshes so it appears.
  on('createFolder', async (folderKey: string) => {
    if (isVirtualFolderKey(folderKey)) {
      createUniqueVirtualFolder();
      return;
    }
    try {
      await ipcInvoke('createFolder', folderKey);
      tm.refreshFolder(folderKey);
    } catch (err) {
      log('createFolder failed:', folderKey, err);
    }
  });
  // Rename a folder. Virtual folders rename in place (dup names rejected); native
  // folders are renamed on disk (the OS rejects a name that already exists).
  on('renameFolder', async (folderKey: string, newName: string) => {
    if (isVirtualFolderKey(folderKey)) {
      const id = virtualFolderIdFromKey(folderKey);
      const ok = id ? tm.renameVirtualFolder(id, newName) : false;
      stream.send('renameFolderResult', folderKey, ok, ok ? '' : 'A folder with that name already exists.');
      sendVirtualFolders();
      return;
    }
    try {
      const parent = path.dirname(folderKey);
      const dest = path.join(parent, newName);
      await ipcInvoke('renameFolder', folderKey, dest);
      // Proactively re-scan the parent so the rename shows without waiting on the
      // OS watcher (which can be unreliable, e.g. on network drives) — mirrors the
      // proactive refresh createFolder does.
      tm.refreshFolder(parent);
      stream.send('renameFolderResult', folderKey, true, '');
    } catch (err) {
      log('renameFolder failed:', folderKey, err);
      stream.send('renameFolderResult', folderKey, false, `${(err as Error).message ?? err}`);
    }
  });
  // ── Virtual folder management (view → thumber) ──────────────────────
  on('requestVirtualFolders', () => stream.send('virtualFolders', virtualFolderState()));
  // Top-level "New Virtual Folder" command: make an empty, uniquely-named one.
  on('newVirtualFolder', () => createUniqueVirtualFolder());
  on('createVirtualFolder', (name: string) => {
    tm.createVirtualFolder(name);
    sendVirtualFolders();
  });
  on('addToVirtualFolder', (id: string, entries: VirtualFolderAddEntry[]) => {
    tm.addFilesToVirtualFolder(id, entries);
    sendVirtualFolders();
  });
  on('removeFromVirtualFolder', (id: string, filePath: string) => {
    tm.removeFileFromVirtualFolder(id, filePath);
  });
  // ── Drag & drop of real files between native folders ────────────────
  // The destination folder's watcher surfaces the new files; for a move we also
  // proactively drop the file from its source (and any virtual folders).
  on('copyFiles', async (paths: string[], destDir: string) => {
    for (const src of paths) {
      try {
        await ipcInvoke('copyFileToDir', src, destDir);
      } catch (err) {
        log('copyFile failed:', src, err);
      }
    }
    tm.refreshFolder(destDir); // surface the new files without waiting on the watcher
  });
  on('moveFiles', async (paths: string[], destDir: string) => {
    for (const src of paths) {
      try {
        await ipcInvoke('moveFileToDir', src, destDir);
        tm.removeFile(src);
      } catch (err) {
        log('moveFile failed:', src, err);
      }
    }
    tm.refreshFolder(destDir); // surface the moved files without waiting on the watcher
  });
  // Pull-based init: the renderer asks for the current snapshot once it has its
  // 'updateFiles' listener attached (pushing on connect would race that wiring).
  on('requestAll', () => {
    tm.sendAll(stream);
  });
}
