/*
  Renderer-side helpers to control the current BrowserWindow via IPC,
  replacing @electron/remote's getCurrentWindow().
*/

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ipcRenderer } = require('electron');

// ── Renderer API ──

export function isFullScreen(): Promise<boolean> {
  return ipcRenderer.invoke('window:isFullScreen');
}

export function setFullScreen(flag: boolean): void {
  ipcRenderer.send('window:setFullScreen', flag);
}

export function setMenu(menu: null): void {
  ipcRenderer.send('window:setMenu', menu);
}

export function hideWindow(): void {
  ipcRenderer.send('window:hide');
}

export function showWindowInactive(): void {
  ipcRenderer.send('window:showInactive');
}

export function inspectElement(x: number, y: number): void {
  ipcRenderer.send('window:inspectElement', x, y);
}

export function showOpenDialog(options: { title?: string; properties?: string[] }): Promise<{ canceled: boolean; filePaths: string[] }> {
  return ipcRenderer.invoke('window:showOpenDialog', options);
}

export function isAnyWindowFullScreen(): boolean {
  return ipcRenderer.sendSync('window:isAnyFullScreen');
}
