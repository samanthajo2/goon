import { spawnSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

spawnSync(electronPath, ['main.js', ...process.argv.slice(3)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: process.argv[2] || 'production',
  },
});
