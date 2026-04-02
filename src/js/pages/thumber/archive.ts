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
import mime from 'mime-types';
import * as unzipit from 'unzipit';
import debug, { Logger } from '../../lib/debug';
import * as filters from '../../lib/filters';
import * as utils from '../../lib/utils';
// Defer loading the native libunrar module until it's actually needed so
// unit tests (which run in Node) don't attempt to execute browser-only
// code at module import time.

const pfs = fs.promises;
const s_slashRE = /[/\\]/g;
function makeSafeName(name: string): string {
  return name.replace(s_slashRE, '|');
}

unzipit.setOptions({
  workerURL: utils.urlFromFilename(require.resolve('unzipit/dist/unzipit-worker.js')),
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

type RarDirectory = {
  type: 'dir';
  ls: Record<string, RarEntry>;
}

type RarFile = {
  type: 'file';
  fileContent: { buffer: Buffer };
  fileSize: number;
  fullFileName: string;
}

type RarEntry = RarDirectory | RarFile;

function gatherRarFiles(entry: RarEntry, files: ArchiveFiles, logger: Logger) {
  const type = entry.type;
  switch (type) {
    case 'file': {
      const name = entry.fullFileName;
      if (!filters.isArchiveFilenameWeCareAbout(name)) {
        return;
      }
      const type = mime.lookup(name) || '';
      const content = entry.fileContent.buffer;
      const blob = async () => new Blob([content.buffer as ArrayBuffer], { type: type, });
      const safeName = makeSafeName(name);
      files[safeName] = {
        type,
        blob,
        size: entry.fileSize,
        // We don't have mtime from this lib so just put in a date that should fail.
        // The idea is we'll check the archive mtime and if that's changed then
        // we'll scan all the files inside here.
        mtime: Date.now(),
      };
      break;
    }
    case 'dir': {
      Object.keys(entry.ls).forEach((name) => {
        gatherRarFiles(entry.ls[name], files, logger);
      });
      break;
    }
    default:
      logger('Unknown type:', type);
      break;
  }
}

async function rarDecompress(filename: string) {
  const _logger = debug('RarDecompressor', filename);
  const _files = {};
  const data = await pfs.readFile(filename);
  _logger('unrar:', filename);
  // Require libunrar lazily. This module assumes a non-Node environment
  // in some builds; requiring it at module-load time can throw during
  // unit tests. Load it only when needed.
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const readRARContent = require('../../../../app/3rdparty/libunrar-js/libunrar');
  const rarContent = readRARContent([
    { name: 'tmp.rar', content: data },
  ], undefined, (/* ...args */) => {
    // _logger("process:", ...args);
  }) as unknown as RarEntry;
  gatherRarFiles(rarContent, _files, _logger);
  return _files;
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
