// Re-exports for main-process-only CJS packages.

import electronUpdater from 'electron-updater';
export const { autoUpdater } = electronUpdater;
