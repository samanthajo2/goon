/*
  Web-browser-backed Platform implementation. Used by external-view.tsx when
  the view page is served from the optional HTTP server (mobile / remote
  browser scenario).

  Capabilities that don't make sense on web (trash, reveal-in-finder,
  drag-to-OS, ...) are omitted; the UI checks for their presence and hides
  the affordance.
*/

import { createWebChannelStream } from './web-channel-stream.js';
import type { ActionId } from './actions.js';
import type { Platform, WindowKind } from './platform.js';

type ServerConfig = {
  // Map of absolute-folder-path to URL-prefix served by the express folder
  // router (e.g. "/Users/me/Pictures" → "folder-abc123").
  folders: Record<string, string>;
  // Absolute path of the Electron userDataDir, served at /user-data-dir/...
  userDataDir: string;
};

async function fetchConfig(): Promise<ServerConfig> {
  const r = await fetch('/api/config');
  if (!r.ok) throw new Error(`/api/config: HTTP ${r.status}`);
  return r.json();
}

function pathToUrl(filePath: string, config: ServerConfig): string {
  // Thumbnail URLs may carry a `?cache=N` cache-bust suffix appended by
  // the thumber. Strip it before path-prefix matching so we don't encode
  // the `?` into the path; re-append it on the resulting URL.
  const qIdx = filePath.indexOf('?');
  const query = qIdx >= 0 ? filePath.slice(qIdx) : '';
  const bare = qIdx >= 0 ? filePath.slice(0, qIdx) : filePath;
  // Try the user-data dir first (covers thumbnail-page paths).
  if (config.userDataDir && bare.startsWith(config.userDataDir)) {
    return '/user-data-dir/' + encodeSegments(bare.slice(config.userDataDir.length)) + query;
  }
  // Walk folders longest-prefix-first so a nested watch folder beats a parent.
  const dirs = Object.keys(config.folders).sort((a, b) => b.length - a.length);
  for (const dir of dirs) {
    if (bare.startsWith(dir)) {
      return '/' + config.folders[dir] + '/' + encodeSegments(bare.slice(dir.length)) + query;
    }
  }
  // No mapping — fall back to URL-encoded path, will likely 404 but at
  // least it's diagnostic.
  return '/' + encodeSegments(bare) + query;
}

function encodeSegments(p: string): string {
  return p.replace(/^[\\/]+/, '').replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
}

export async function createWebPlatform(): Promise<Platform> {
  const config = await fetchConfig();

  return {
    createChannelStream(channelId: string) {
      return createWebChannelStream(channelId);
    },
    fileToUrl(filePath: string) {
      return pathToUrl(filePath, config);
    },
    toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    },
    setupFullscreen() {
      // No menu-bar peek behavior in a regular browser.
    },
    openNewWindow(_kind: WindowKind) {
      // Only `view` makes sense on web. `prefs`/`help` are desktop-only —
      // open a fresh viewer tab for everything else; the UI for those
      // should be hidden in web mode anyway.
      window.open('/', '_blank');
    },
    saveWinState(state: unknown) {
      try { localStorage.setItem('goon.winState', JSON.stringify(state)); } catch { /* full disk etc. */ }
    },
    saveSplitLayout(layout: unknown) {
      try { localStorage.setItem('goon.splitLayout', JSON.stringify(layout)); } catch { /* full disk etc. */ }
    },
    onAction(_handler: (actionId: ActionId) => void) {
      // No menu bar in the browser — nothing to subscribe to.
      return () => { /* no-op unsubscribe */ };
    },
    // Optional methods intentionally omitted:
    //   trashItem, deleteFile, deleteFolder, showItemInFolder, openPath,
    //   startDrag, launchBrowser, launchExternalViewer, checkFileExists.
  };
}

export function loadStartState(): { winState?: unknown; layout?: unknown } | undefined {
  try {
    const winStateStr = localStorage.getItem('goon.winState');
    const layoutStr = localStorage.getItem('goon.splitLayout');
    if (!winStateStr && !layoutStr) return undefined;
    return {
      winState: winStateStr ? JSON.parse(winStateStr) : undefined,
      layout: layoutStr ? JSON.parse(layoutStr) : undefined,
    };
  } catch {
    return undefined;
  }
}
