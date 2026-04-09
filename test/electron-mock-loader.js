// Mock loader for Electron-ecosystem packages when running tests under plain Node.js.
// These APIs are only available inside the Electron runtime. This provides empty stubs
// so test files that transitively import them can load.

const electronPackages = new Set([
  'electron',
  '@electron/remote',
  '@electron/remote/main',
  '@electron/remote/main/index.js',
  'electron-updater',
]);

export async function resolve(specifier, context, nextResolve) {
  if (electronPackages.has(specifier)) {
    return {
      shortCircuit: true,
      url: `electron-mock://${encodeURIComponent(specifier)}`,
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('electron-mock://')) {
    return {
      shortCircuit: true,
      format: 'module',
      source: `
        const noop = () => {};
        const handler = { get: (_, prop) => prop === 'then' ? undefined : noop };
        const proxy = new Proxy({}, handler);
        export default proxy;
        export const ipcRenderer = proxy;
        export const ipcMain = proxy;
        export const shell = proxy;
        export const BrowserWindow = class {};
        export const nativeImage = proxy;
        export const WebContents = class {};
        export const Rectangle = class {};
        export const dialog = proxy;
        export const Menu = class {};
        export const MenuItem = class {};
        export const getCurrentWindow = noop;
        export const initialize = noop;
        export const isInitialized = noop;
        export const enable = noop;
        export const createChannel = noop;
        export const createChannelStream = noop;
        export const autoUpdater = proxy;
        const require = noop;
        export { require as require };
      `,
    };
  }
  return nextLoad(url, context);
}
