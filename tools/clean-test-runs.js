// Remove all temp/run-* directories left behind by run-with-test-data.js.

import { rmSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = path.join(repoRoot, 'temp');

if (!existsSync(tempRoot)) {
  console.log('no temp/ directory; nothing to clean');
  process.exit(0);
}

const entries = readdirSync(tempRoot, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name.startsWith('run-'));

if (entries.length === 0) {
  console.log('no run-* directories to clean');
  process.exit(0);
}

for (const entry of entries) {
  const p = path.join(tempRoot, entry.name);
  console.log(`removing ${p}`);
  rmSync(p, { recursive: true, force: true });
}
console.log(`removed ${entries.length} run director${entries.length === 1 ? 'y' : 'ies'}`);
