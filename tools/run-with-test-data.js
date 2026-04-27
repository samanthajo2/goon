// Launch the app with a sacrificial copy of test/data so you can delete files
// without having to `git restore` afterwards.
//
// Usage:
//   node tools/run-with-test-data.js [extra electron args...]
// Example:
//   npm run start-test
//
// Each run creates a fresh temp dir under temp/ named with a timestamp and
// passes it as the folder argument plus a fresh --user-data-dir. Old temp
// runs are NOT deleted automatically — use `npm run clean-test-data` for that.

import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceData = path.join(repoRoot, 'test', 'data');
const tempRoot = path.join(repoRoot, 'temp');

if (!existsSync(sourceData)) {
  console.error(`source data dir not found: ${sourceData}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const runDir = path.join(tempRoot, `run-${stamp}`);
const dataDir = path.join(runDir, 'data');
const userDataDir = path.join(runDir, 'user-data');

mkdirSync(runDir, { recursive: true });
mkdirSync(userDataDir, { recursive: true });

console.log(`copying ${sourceData} → ${dataDir}`);
cpSync(sourceData, dataDir, { recursive: true });
console.log(`launching with --user-data-dir=${userDataDir}`);
console.log(`folder arg: ${dataDir}`);

const args = [
  'main.js',
  `--user-data-dir=${userDataDir}`,
  dataDir,
  ...process.argv.slice(2),
];

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  cwd: repoRoot,
  env: { ...process.env, NODE_ENV: 'development' },
});

child.on('exit', (code) => {
  console.log(`\napp exited with code ${code}`);
  console.log(`run dir kept at: ${runDir}`);
  process.exit(code ?? 0);
});
