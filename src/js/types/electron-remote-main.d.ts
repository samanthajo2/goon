declare module '@electron/remote/main/index.js' {
  export function initialize(): void;
  export function isInitialized(): boolean;
  export function enable(webContents: Electron.WebContents): void;
}
