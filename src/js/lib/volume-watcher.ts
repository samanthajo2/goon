/*
  Platform-abstracted volume mount/unmount watcher.
  Calls the provided callback when storage volumes change.
*/

import fs from 'node:fs';

export function watchVolumes(onChange: () => void): { close: () => void } {
  const platform = process.platform;
  let watcher: fs.FSWatcher | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const debounced = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      onChange();
    }, 2000);
  };

  if (platform === 'darwin') {
    try {
      watcher = fs.watch('/Volumes', debounced);
    } catch {
      // /Volumes may not be watchable in some environments
    }
  } else if (platform === 'linux') {
    // /media/<user> or /mnt are common mount points
    try {
      watcher = fs.watch('/media', { recursive: true }, debounced);
    } catch {
      try {
        watcher = fs.watch('/mnt', debounced);
      } catch {
        // neither watchable
      }
    }
  }
  // Windows: no simple fs.watch equivalent for drive letters;
  // user can use the refreshFolders action manually.

  return {
    close() {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher?.close();
    },
  };
}
