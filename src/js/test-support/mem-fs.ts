/*
Copyright 2026 SamanthaJo

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

// A tiny in-memory filesystem covering exactly the surface the integration harness
// and fs-ops exercise — no more. Deliberately hand-rolled rather than pulling in a
// full fs implementation: we only need a path→node map with the handful of calls
// below, and we'd rather own 130 lines than a 14-package dependency tree.

import path from 'node:path';

type Stat = { size: number; mtimeMs: number; isDirectory: () => boolean; isFile: () => boolean };
type Node = { dir: boolean; content: Buffer; mtimeMs: number };

function enoent(op: string, p: string): NodeJS.ErrnoException {
  const e = new Error(`ENOENT: no such file or directory, ${op} '${p}'`) as NodeJS.ErrnoException;
  e.code = 'ENOENT';
  return e;
}

export type MemFs = ReturnType<typeof createMemFs>;

export function createMemFs() {
  // Keyed by normalized posix path. '/' always exists as the root directory.
  const nodes = new Map<string, Node>();
  let clock = 1; // monotonic stand-in for mtimeMs so unchanged files keep a stable time
  nodes.set('/', { dir: true, content: Buffer.alloc(0), mtimeMs: clock++ });

  const norm = (p: string): string => {
    const n = path.posix.normalize(p).replace(/\/+$/, '');
    return n === '' ? '/' : n;
  };
  const get = (p: string): Node | undefined => nodes.get(norm(p));
  const statOf = (n: Node): Stat => ({
    size: n.content.length,
    mtimeMs: n.mtimeMs,
    isDirectory: () => n.dir,
    isFile: () => !n.dir,
  });

  function mkdirSync(p: string, opts?: { recursive?: boolean }): void {
    const target = norm(p);
    if (nodes.has(target)) {
      if (get(target)!.dir) return;
      throw new Error(`EEXIST: file already exists, mkdir '${p}'`);
    }
    const parent = path.posix.dirname(target);
    if (!nodes.has(parent)) {
      if (!opts?.recursive) throw enoent('mkdir', p);
      mkdirSync(parent, opts);
    }
    nodes.set(target, { dir: true, content: Buffer.alloc(0), mtimeMs: clock++ });
  }

  function writeFileSync(p: string, data: string | Buffer, encoding?: BufferEncoding): void {
    const target = norm(p);
    const parent = path.posix.dirname(target);
    if (!nodes.has(parent) || !nodes.get(parent)!.dir) throw enoent('open', p);
    const content = Buffer.isBuffer(data) ? data : Buffer.from(data, encoding ?? 'utf8');
    nodes.set(target, { dir: false, content, mtimeMs: clock++ });
  }

  function readFileSync(p: string, encoding?: BufferEncoding): string | Buffer {
    const n = get(p);
    if (!n || n.dir) throw enoent('open', p);
    return encoding ? n.content.toString(encoding) : n.content;
  }

  function readdirSync(p: string): string[] {
    const dir = norm(p);
    const n = nodes.get(dir);
    if (!n || !n.dir) throw enoent('scandir', p);
    const prefix = dir === '/' ? '/' : `${dir}/`;
    const names: string[] = [];
    for (const key of nodes.keys()) {
      if (key === dir || !key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (!rest.includes('/')) names.push(rest);
    }
    return names.sort();
  }

  function statSync(p: string): Stat {
    const n = get(p);
    if (!n) throw enoent('stat', p);
    return statOf(n);
  }

  function unlinkSync(p: string): void {
    const target = norm(p);
    if (!nodes.has(target)) throw enoent('unlink', p);
    nodes.delete(target);
  }

  function rmRecursive(p: string): void {
    const target = norm(p);
    const prefix = `${target}/`;
    for (const key of [...nodes.keys()]) {
      if (key === target || key.startsWith(prefix)) nodes.delete(key);
    }
  }

  function renameSync(from: string, to: string): void {
    const src = norm(from);
    const dst = norm(to);
    if (!nodes.has(src)) throw enoent('rename', from);
    const prefix = `${src}/`;
    for (const key of [...nodes.keys()]) {
      if (key === src) {
        nodes.set(dst, nodes.get(key)!);
        nodes.delete(key);
      } else if (key.startsWith(prefix)) {
        nodes.set(dst + key.slice(src.length), nodes.get(key)!);
        nodes.delete(key);
      }
    }
  }

  function copyFileSync(from: string, to: string): void {
    const n = get(from);
    if (!n || n.dir) throw enoent('copyfile', from);
    writeFileSync(to, Buffer.from(n.content));
  }

  // Defer callbacks like the real async fs so scan ordering matches production.
  const cb = <T>(fn: () => T, callback: (err: Error | null, result?: T) => void): void => {
    process.nextTick(() => {
      try { callback(null, fn()); } catch (e) { callback(e as Error); }
    });
  };
  const p = <T>(fn: () => T): Promise<T> => new Promise((resolve, reject) => {
    process.nextTick(() => { try { resolve(fn()); } catch (e) { reject(e); } });
  });

  return {
    // Sync
    existsSync: (fp: string) => nodes.has(norm(fp)),
    statSync,
    readdirSync,
    readFileSync,
    writeFileSync,
    unlinkSync,
    mkdirSync,
    // Convenience matching the app's fs adapter shape
    readFileAsStringSync: (fp: string) => readFileSync(fp, 'utf8') as string,
    writeFileBase64Sync: (fp: string, data: string) => writeFileSync(fp, data, 'base64'),
    // Callback style (used by the folder watcher)
    readdir: (fp: string, callback: (err: Error | null, files: string[]) => void) =>
      cb(() => readdirSync(fp), callback as (err: Error | null, r?: string[]) => void),
    stat: (fp: string, callback: (err: Error | null, stats: Stat) => void) =>
      cb(() => statSync(fp), callback as (err: Error | null, r?: Stat) => void),
    // Promise style (used by fs-ops)
    promises: {
      mkdir: (fp: string, opts?: { recursive?: boolean }) => p(() => mkdirSync(fp, opts)),
      rm: (fp: string, opts: { recursive: boolean; force: boolean }) => p(() => {
        if (!nodes.has(norm(fp))) {
          if (opts.force) return;
          throw enoent('rm', fp);
        }
        if (opts.recursive) rmRecursive(fp); else unlinkSync(fp);
      }),
      rename: (from: string, to: string) => p(() => renameSync(from, to)),
      copyFile: (from: string, to: string) => p(() => copyFileSync(from, to)),
      unlink: (fp: string) => p(() => unlinkSync(fp)),
    },
  };
}
