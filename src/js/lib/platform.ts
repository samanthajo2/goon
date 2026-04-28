/*
  Platform-capability surface used by the view page.

  There are (or will be) two implementations:

    - Electron — methods are wired to ipcRenderer / shell. The desktop app
      uses this.
    - Web — methods that have no browser equivalent (trash, reveal-in-finder,
      drag-to-OS, ...) are omitted; UI checks for their presence and hides
      the corresponding affordance. Methods with different impls per
      platform (fullscreen, openNewWindow) are required and provided by both.

  Renderer code consumes this via the AppContext (`context.platform`) — it
  must NOT import `ipcRenderer` directly.
*/

import type { ActionId } from './actions.js';
import type { ChannelStream } from './window-ipc.js';

export type WindowKind = 'view' | 'prefs' | 'help';

export type Platform = {
  // ── Required (both platforms) ───────────────────────────────────────

  // Open a bidirectional channel-stream to a named peer. On Electron this
  // is the `otherWindowIPC` relay; on web it'll be a WebSocket-backed
  // implementation of the same interface.
  createChannelStream(channelId: string): Promise<ChannelStream>;

  // Turn an absolute file path into a URL the renderer can use as <img src>
  // or CSS background-image. On Electron this is a file:// URL (or the
  // bare path that resolves against the file:// origin). On web it's a
  // path served by the express folder router (e.g. `/<prefix>/...`).
  fileToUrl(filePath: string): string;

  toggleFullscreen(): void | Promise<void>;
  setupFullscreen(): void | Promise<void>;
  openNewWindow(kind: WindowKind): void;
  saveWinState(state: unknown): void;
  saveSplitLayout(layout: unknown): void;
  // Subscribe to action dispatches that originate outside the renderer
  // (e.g. the Electron menu bar). Returns an unsubscribe function. On web
  // there is no menu, so the impl returns a no-op unsubscribe.
  onAction(handler: (actionId: ActionId) => void): () => void;

  // ── Optional (desktop-only) ─────────────────────────────────────────
  trashItem?(filename: string): Promise<void>;
  deleteFile?(filename: string): Promise<void>;
  showItemInFolder?(filename: string): void;
  openPath?(filename: string): void;
  // Start a native OS drag for the given file(s).
  startDrag?(files: string | string[]): void;
  // Open the file in the system browser via the local HTTP server.
  launchBrowser?(filename: string): void;
  launchExternalViewer?(viewerPath: string, filename: string): void;
  checkFileExists?(filename: string): Promise<boolean>;
};
