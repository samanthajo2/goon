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

// The filesystem mutations the app performs, as pure functions over an injected
// fs. main.ts wires these to Electron's `ipcMain.handle(...)` with the real
// `node:fs`; the integration-test harness wires the *same* functions to an
// in-memory fs. Keeping one implementation means the tested behavior can't drift
// from what ships.

import path from 'node:path';

export type FsOpsFs = {
  existsSync: (p: string) => boolean;
  promises: {
    unlink: (p: string) => Promise<void>;
    rm: (p: string, opts: { recursive: boolean; force: boolean }) => Promise<void>;
    mkdir: (p: string) => Promise<unknown>;
    rename: (from: string, to: string) => Promise<void>;
    copyFile: (from: string, to: string) => Promise<void>;
  };
};

// Pick a destination path in destDir for src that doesn't clobber an existing entry
// (appends " 2", " 3", … like Finder).
export function uniqueDestPath(fs: FsOpsFs, destDir: string, src: string): string {
  const base = path.basename(src);
  let candidate = path.join(destDir, base);
  if (!fs.existsSync(candidate)) return candidate;
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let i = 2; ; i++) {
    candidate = path.join(destDir, `${stem} ${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

export async function deleteFile(fs: FsOpsFs, filename: string): Promise<void> {
  await fs.promises.unlink(filename);
}

export async function deleteFolder(fs: FsOpsFs, dir: string): Promise<void> {
  await fs.promises.rm(path.resolve(dir), { recursive: true, force: true });
}

// Make a new "Untitled" subfolder (deduped like Finder) inside parentDir. Returns
// the created path.
export async function createFolder(fs: FsOpsFs, parentDir: string): Promise<string> {
  const dest = uniqueDestPath(fs, parentDir, 'Untitled');
  await fs.promises.mkdir(dest);
  return dest;
}

// Rename (move) a folder. Rejects when dest already exists, surfacing to the user
// as "name already in use".
export async function renameFolder(fs: FsOpsFs, src: string, dest: string): Promise<string> {
  if (fs.existsSync(dest)) {
    throw new Error('A folder with that name already exists.');
  }
  await fs.promises.rename(path.resolve(src), path.resolve(dest));
  return dest;
}

export async function moveFileToDir(fs: FsOpsFs, src: string, destDir: string): Promise<string> {
  const dest = uniqueDestPath(fs, destDir, src);
  try {
    await fs.promises.rename(src, dest);
  } catch (e) {
    // Cross-device move: copy then remove.
    if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
      await fs.promises.copyFile(src, dest);
      await fs.promises.unlink(src);
    } else {
      throw e;
    }
  }
  return dest;
}

export async function copyFileToDir(fs: FsOpsFs, src: string, destDir: string): Promise<string> {
  const dest = uniqueDestPath(fs, destDir, src);
  await fs.promises.copyFile(src, dest);
  return dest;
}
