import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');

// Renderer entry points: each HTML page has one entry
const entryPoints = {
  view:        'src/js/pages/view/view.tsx',
  help:        'src/js/pages/help/help.ts',
  password:    'src/js/pages/password/password.tsx',
  preferences: 'src/js/pages/prefs/preferences.tsx',
  thumber:     'src/js/pages/thumber/thumber.tsx',
  update:      'src/js/pages/update/update.tsx',
};

const buildOptions = {
  entryPoints,
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
  external: ['electron', 'electron-updater'],
  logLevel: 'info',
  logOverride: { 'empty-import-meta': 'silent' },
};

function postProcess() {
  // The "electron" npm package's CJS exports don't set __esModule.
  // esbuild wraps default imports with __toESM(require("electron"), 1)
  // where the ,1 flag means "always set .default = module.exports".
  //
  // Without ,1: __toESM checks for __esModule. If absent, it ALSO sets
  // .default = module.exports. So for "electron" (no __esModule), the
  // result is the same either way — .default works.
  //
  // But the REAL problem is that `import electron from "electron"` in our
  // source makes esbuild access `import_electron.default.BrowserWindow`.
  // With __toESM (either flag), .default IS the module, so this works.
  //
  // The actual issue was that .cjs files were being loaded as ESM by Node
  // due to missing .cjs extension — now fixed by outExtension.
}

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching for renderer changes...');
} else {
  await esbuild.build(buildOptions);
}
