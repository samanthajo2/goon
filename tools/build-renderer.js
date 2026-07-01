import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

// Renderer entry points: each HTML page has one entry. These run inside
// Electron WebContents with Node integration enabled, so they're built
// as CJS for `platform: 'node'`.
const electronEntryPoints = {
  view:        'src/js/pages/view/view.tsx',
  help:        'src/js/pages/help/help.ts',
  password:    'src/js/pages/password/password.tsx',
  preferences: 'src/js/pages/prefs/preferences.tsx',
  thumber:     'src/js/pages/thumber/thumber.tsx',
  update:      'src/js/pages/update/update.tsx',
  browser:     'src/js/pages/browser/browser.tsx',
};

const electronBuildOptions = {
  entryPoints: electronEntryPoints,
  // Disable React 19's User Timing instrumentation. In dev builds React calls
  // performance.measure() on every render and scheduling lane, gated solely on
  // typeof console.timeStamp === 'function'. The entries accumulate forever and
  // after ~7 minutes V8 OOMs cloning the next measure-options object, taking
  // the renderer with it.
  banner: { js: 'console.timeStamp=undefined;' },
  bundle: true,
  outdir: 'out/renderer',
  outExtension: { '.js': '.cjs' },
  platform: 'node',
  format: 'cjs',
  jsx: 'transform',
  sourcemap: 'inline',
  // Electron built-in modules — must remain as bare require() at runtime.
  // The npm "electron" package is just a path to the binary; the real API
  // is only available via require("electron") inside the Electron runtime.
  // @parcel/watcher is a native (.node) module: it can't be bundled, so it
  // stays a runtime require() resolved from node_modules (unpacked from asar).
  external: ['electron', '@parcel/watcher'],
  logLevel: 'info',
  logOverride: { 'empty-import-meta': 'silent' },
};

// When building for production (CI / shipped builds), bake NODE_ENV='production'
// into the renderer bundles. esbuild then dead-code-eliminates the dev variants
// of React/scheduler at bundle time, dropping them from the output entirely
// (otherwise both dev and prod React are bundled and the runtime if-check picks
// one). Local `npm run build` leaves the substitution off so dev/prod can still
// be toggled at runtime via the launch script.
if (process.env.NODE_ENV === 'production') {
  electronBuildOptions.define = {
    'process.env.NODE_ENV': '"production"',
  };
}

// Browser entry points: served by the optional HTTP server when enableWeb
// is on. These run in a vanilla browser, so we alias Node modules to
// browser-compatible polyfills and never bundle Electron.
const browserEntryPoints = {
  external: 'src/js/pages/view/external-view.tsx',
};

const browserBuildOptions = {
  entryPoints: browserEntryPoints,
  bundle: true,
  outdir: 'out/external',
  platform: 'browser',
  format: 'iife',
  jsx: 'transform',
  sourcemap: 'inline',
  alias: {
    'node:events': 'events',
    'events': 'events',
    'node:path': 'path-browserify',
    'path': 'path-browserify',
  },
  // Provide `globalThis.process` for shared code (debug.ts reads
  // process.env.DEBUG, MediaManagerClient does process.nextTick, etc.).
  inject: ['./src/js/lib/web-stubs/process-polyfill.ts'],
  external: [],
  // Map Node-only deps that appear at module-load time to a tiny shim file
  // that exports an empty object — code paths that try to use them would
  // throw, but the view tree never reaches those paths in web mode.
  loader: {},
  define: {
    'process.platform': '"web"',
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
  logOverride: { 'empty-import-meta': 'silent' },
};
// Alias unconditionally Node-only modules to a shared empty stub.
browserBuildOptions.alias['node:fs'] = './src/js/lib/web-stubs/empty.ts';
browserBuildOptions.alias['fs'] = './src/js/lib/web-stubs/empty.ts';
browserBuildOptions.alias['graceful-fs'] = './src/js/lib/web-stubs/empty.ts';
browserBuildOptions.alias['node:crypto'] = './src/js/lib/web-stubs/empty.ts';
browserBuildOptions.alias['crypto'] = './src/js/lib/web-stubs/empty.ts';
browserBuildOptions.alias['rimraf'] = './src/js/lib/web-stubs/empty.ts';

if (watch) {
  const electron = await esbuild.context(electronBuildOptions);
  const browser = await esbuild.context(browserBuildOptions);
  await Promise.all([electron.watch(), browser.watch()]);
  console.log('Watching for renderer changes...');
} else {
  await Promise.all([
    esbuild.build(electronBuildOptions),
    esbuild.build(browserBuildOptions),
  ]);
}
