import { spawnSync } from 'child_process';

spawnSync('electron', ['main.js'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env, 
    NODE_ENV: process.argv[2] || 'production',
  },
});