import * as esbuild from 'esbuild';

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
  external: ['electron'],
  logLevel: 'info',
  logOverride: { 'empty-import-meta': 'silent' },
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching for renderer changes...');
} else {
  await esbuild.build(buildOptions);
}
