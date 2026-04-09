/*
Copyright 2024 SamanthaJo

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import fs from 'node:fs';
import { createRequire } from 'node:module';
import mime from 'mime-types';
import * as unzipit from 'unzipit';
import * as unrarit from 'unrarit';
import * as filters from '../../lib/filters.js';
import * as utils from '../../lib/utils.js';

// In ESM (main process / tests), create a require function; in CJS (renderer bundle), use the global.
const _require = typeof require !== 'undefined' ? require : createRequire(import.meta.url);

const pfs = fs.promises;
const s_slashRE = /[/\\]/g;
function makeSafeName(name: string): string {
  return name.replace(s_slashRE, '|');
}

unzipit.setOptions({
  workerURL: utils.urlFromFilename(_require.resolve('unzipit/dist/unzipit-worker.js')),
  numWorkers: 2,
});

export type ArchiveFile = {
  type: string,
  blob: () => Promise<Blob>,
  size: number,
  mtime: number,
};
export type ArchiveFiles = Record<string, ArchiveFile>;

class StatelessFileReader {
  filename: string;
  length: number | undefined;

  constructor(filename: string) {
    this.filename = filename;
  }
  async getLength() {
    if (this.length === undefined) {
      const stat = await pfs.stat(this.filename);
      this.length = stat.size;
    }
    return this.length;
  }
  async read(offset: number, length: number) {
    const fh = await pfs.open(this.filename);
    const data = new Uint8Array(length);
    await fh.read(data, 0, length, offset);
    await fh.close();
    return data;
  }
}

async function zipDecompress(filename: string) {
  const _files: ArchiveFiles = {};

  try {
    const reader = new StatelessFileReader(filename);
    const {entries: zipFiles} = await unzipit.unzip(reader);
    const zipNames = Object.keys(zipFiles);
    // TODO: do I want to support videos?
    zipNames.filter(filters.isArchiveFilenameWeCareAbout).forEach((name) => {
      const zipOb = zipFiles[name];
      const type = mime.lookup(name) || '';
      const blob = () => zipOb.blob(type);
      const safeName = makeSafeName(name);  // this is to remove folders (needed?)
      _files[safeName] = {
        type,
        blob,
        size: zipOb.size,
        mtime: zipOb.lastModDate.getTime(),
      };
    });
    return _files;
  } catch (err) {
    console.warn(err);
    throw err;
  }
}

async function rarDecompress(filename: string) {
  const _files: ArchiveFiles = {};

  try {
    const reader = new StatelessFileReader(filename);
    const {entries: zipFiles} = await unrarit.unrar(reader);
    const zipNames = Object.keys(zipFiles);
    // TODO: do I want to support videos?
    zipNames.filter(filters.isArchiveFilenameWeCareAbout).forEach((name) => {
      const zipOb = zipFiles[name];
      const type = mime.lookup(name) || '';
      const blob = () => zipOb.blob(type);
      const safeName = makeSafeName(name);  // this is to remove folders (needed?)
      _files[safeName] = {
        type,
        blob,
        size: zipOb.size,
        mtime: zipOb.lastModDate.getTime(),
      };
    });
    return _files;
  } catch (err) {
    console.warn(err);
    throw err;
  }
}

function mightBeZip(buf: Buffer) {
  return buf[0] === 0x50 && // P
         buf[1] === 0x4B;   // K
}

function mightBeRar(buf: Buffer) {
  // Check for `Rar!`
  return buf[0] === 0x52 && // R
         buf[1] === 0x61 && // a
         buf[2] === 0x72 && // r
         buf[3] === 0x21;   // !
}

async function createDecompressor(filename: string): Promise<ArchiveFiles> {
  const buf = Buffer.alloc(4);
  const fh = await pfs.open(filename, 'r');
  await fh.read(buf, 0, buf.length, null);
  await fh.close();
  if (mightBeZip(buf)) {
    return zipDecompress(filename);
  } else if (mightBeRar(buf)) {
    return rarDecompress(filename);
  } else if (filters.isZip(filename)) {
    // Zips don't technically start with any signature, they end with one
    // but too lazy to check that for now
    return zipDecompress(filename);
  } else {
    throw new Error('unknown file type');
  }
}

export {
  createDecompressor,
};
