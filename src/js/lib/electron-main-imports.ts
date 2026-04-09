// Re-exports for main-process-only CJS packages.
// These MUST NOT be imported from renderer processes.

export { default as electronRemoteMain } from '@electron/remote/main/index.js';

import electronUpdater from 'electron-updater';
export const { autoUpdater } = electronUpdater;
