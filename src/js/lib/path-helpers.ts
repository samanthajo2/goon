/*
  Tiny path helpers usable in both Electron renderer and pure-browser bundles.

  Why not import from `path`? Node's `path` module isn't available in a vanilla
  browser bundle — bundling it via path-browserify works but adds weight, and
  we only ever need three operations on POSIX-or-Windows-style paths. These
  three handle either `/` or `\\` separators so they work on absolute Windows
  paths too.
*/

function lastSepIndex(p: string): number {
  for (let i = p.length - 1; i >= 0; i--) {
    if (p[i] === '/' || p[i] === '\\') return i;
  }
  return -1;
}

export function basename(p: string, ext?: string): string {
  const i = lastSepIndex(p);
  let name = i < 0 ? p : p.slice(i + 1);
  if (ext && name.endsWith(ext) && name !== ext) {
    name = name.slice(0, -ext.length);
  }
  return name;
}

export function dirname(p: string): string {
  const i = lastSepIndex(p);
  if (i < 0) return '.';
  if (i === 0) return p[0];
  return p.slice(0, i);
}

export function extname(p: string): string {
  const base = basename(p);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot);
}
