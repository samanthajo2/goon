// Boots the Electron app in a temp profile with enableWeb=true, waits for
// the express server, and probes the externally-served endpoints + WebSocket
// bridge. Reports a pass/fail summary and exits.
//
// Usage: node tools/test-web-bundle.js

import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceData = path.join(repoRoot, 'test', 'data');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const runDir = path.join(repoRoot, 'temp', `web-test-${stamp}`);
const dataDir = path.join(runDir, 'data');
const userDataDir = path.join(runDir, 'user-data');

mkdirSync(userDataDir, { recursive: true });
cpSync(sourceData, dataDir, { recursive: true });

// Pre-populate prefs.json so enableWeb is on from boot. Version 2 is current.
writeFileSync(path.join(userDataDir, 'prefs.json'), JSON.stringify({
  version: 2,
  folders: [dataDir],
  misc: { enableWeb: true, password: '' },
}, null, 2));

console.log(`run dir: ${runDir}`);
console.log(`launching electron with enableWeb=true ...`);

const child = spawn(electronPath, [
  'main.js',
  `--user-data-dir=${userDataDir}`,
  dataDir,
], {
  cwd: repoRoot,
  // Enable the `debug('main')` calls so we can see "Web server started on port: NNNN".
  env: { ...process.env, NODE_ENV: 'development', DEBUG: 'main' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let port = null;
function scanForPort(s) {
  // Accept either the debug() line or the `[web]` console.log line we
  // added for unconditional visibility.
  const m = s.match(/(?:Web server started on port|\[web\] server listening on)[: ]\s*(\d+)/);
  if (m) port = parseInt(m[1], 10);
}
child.stdout.on('data', (chunk) => {
  const s = chunk.toString();
  process.stdout.write(s);
  scanForPort(s);
});
child.stderr.on('data', (chunk) => {
  const s = chunk.toString();
  process.stderr.write(s);
  scanForPort(s);
});

// Fallback: probe ports 8080..8089 since getFreePort starts there.
async function probeFallbackPort() {
  for (let p = 8080; p <= 8089; p++) {
    try {
      const r = await fetch(`http://localhost:${p}/api/config`, { signal: AbortSignal.timeout(500) });
      if (r.ok) return p;
    } catch { /* port not bound or wrong service */ }
  }
  return null;
}

function waitForPort(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      if (port) return resolve(port);
      const probed = await probeFallbackPort();
      if (probed) { port = probed; return resolve(port); }
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout waiting for port'));
      setTimeout(check, 500);
    };
    check();
  });
}

async function hit(url) {
  const r = await fetch(url);
  const text = await r.text();
  return { status: r.status, body: text, len: text.length };
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ': ' + detail : ''}`);
}

async function testWebSocket(channelId) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?channel=${channelId}`);
    let openedAt = null;
    let firstMessage = null;
    const timeout = setTimeout(() => {
      ws.close();
      resolve({ opened: !!openedAt, firstMessage });
    }, 5000);
    ws.on('open', () => { openedAt = Date.now(); });
    ws.on('message', (data) => {
      if (!firstMessage) {
        firstMessage = data.toString().slice(0, 200);
      }
    });
    ws.on('close', () => {
      clearTimeout(timeout);
      resolve({ opened: !!openedAt, firstMessage });
    });
    ws.on('error', () => {
      clearTimeout(timeout);
      resolve({ opened: !!openedAt, firstMessage, error: true });
    });
  });
}

try {
  await waitForPort();
  console.log(`\n--- testing port ${port} ---`);

  const root = await hit(`http://localhost:${port}/`);
  check('GET /', root.status === 200, `status=${root.status} len=${root.len}`);
  check('  contains external.js script tag', root.body.includes('/out/external/external.js'));

  const cfg = await hit(`http://localhost:${port}/api/config`);
  check('GET /api/config', cfg.status === 200, `status=${cfg.status}`);
  let cfgJson = null;
  try { cfgJson = JSON.parse(cfg.body); } catch { /* */ }
  check('  /api/config is valid JSON', !!cfgJson);
  check('  /api/config has folders + userDataDir',
    !!cfgJson && typeof cfgJson.folders === 'object' && typeof cfgJson.userDataDir === 'string');

  const bundle = await hit(`http://localhost:${port}/out/external/external.js`);
  check('GET /out/external/external.js', bundle.status === 200, `len=${bundle.len}`);

  const css = await hit(`http://localhost:${port}/app.css`);
  check('GET /app.css', css.status === 200, `len=${css.len}`);

  // Probe WebSocket: connect to thumber and wait briefly to see if we get
  // the auto-pushed updateFiles. After Phase 3 the client requests it via
  // 'requestAll'; we'll just verify the socket OPENs.
  console.log('  attempting WebSocket connection to /ws?channel=thumber ...');
  const ws = await testWebSocket('thumber');
  check('WS /ws?channel=thumber connects', ws.opened);

  console.log('\n--- summary ---');
  const failed = results.filter(r => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('FAILED:');
    for (const r of failed) console.log(`  ${r.name}`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error('test error:', err);
  process.exitCode = 1;
} finally {
  console.log('\nshutting down...');
  child.kill();
  // Give it a moment to clean up.
  setTimeout(() => process.exit(process.exitCode ?? 0), 1000);
}
