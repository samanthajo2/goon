import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronPath = require('electron'); // path to the Electron executable

const nodeEnv = process.argv[2] || 'production';
const passthrough = process.argv.slice(3);
const capture = passthrough.includes('--capture');
const electronArgs = passthrough.filter((a) => a !== '--capture');

if (capture && process.platform === 'darwin') {
  // Screen-recording (getDisplayMedia) attributes macOS TCC permission to the
  // *responsible* process, which for a terminal-launched binary is the parent
  // (Terminal/VS Code). Launching the Electron .app bundle through LaunchServices
  // (`open`) instead makes Electron itself responsible, so the permission attaches to
  // Electron rather than whatever launched us.
  //
  // Trade-offs of `open`: it runs the app with cwd=/ and does NOT inherit our
  // environment, and its stdout/stderr don't come back to this terminal. So we pass an
  // absolute app path, absolutize relative path args, and forward NODE_ENV as a flag
  // that main.js reads (env vars don't survive `open`).
  const bundle = path.resolve(electronPath, '..', '..', '..'); // .../dist/Electron.app
  const cwd = process.cwd();
  const abs = (arg) => {
    const udd = '--user-data-dir=';
    if (arg.startsWith(udd)) return `${udd}${path.resolve(cwd, arg.slice(udd.length))}`;
    if (!arg.startsWith('-')) return path.resolve(cwd, arg); // positional path (e.g. test/data)
    return arg;
  };
  // NODE_ENV can't be forwarded here: env vars don't survive `open`, and the app
  // treats any non-Chromium arg (like --node-env) as a folder to open. So a capture
  // launch runs in production mode (no dev tools) — which is what you want while
  // recording anyway.
  const appArgs = [cwd, ...electronArgs.map(abs)];
  console.log(`launching via 'open' for capture permissions: ${bundle}`);
  const openArgs =  ['-n', bundle, '--args', ...appArgs];
  //console.log('open', ...openArgs);
  const res = spawnSync('open', openArgs, { stdio: 'inherit' });
  process.exit(res.status ?? 0);
} else {
  // Normal launch (all platforms, and macOS without --capture): run the binary
  // directly so console output is inherited here.
  const res = spawnSync(electronPath, ['main.js', ...electronArgs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: nodeEnv,
    },
  });
  process.exit(res.status ?? 0);
}
