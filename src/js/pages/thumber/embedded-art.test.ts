/*
Copyright 2024 SamanthaJo

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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sinon from 'sinon';
import { describe, it, before, after } from '../../lib/test/mocha.js';
import { assert } from 'chai';
import { getEmbeddedArt } from './embedded-art.js';

// Compiled tests live at out/js/src/js/pages/thumber/, so the repo root is
// six up.
const REPO_ROOT = path.join(import.meta.dirname, '..', '..', '..', '..', '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'test', 'data', 'audio');

let tempDir = '';
// The reader logs what it couldn't read; the failure cases here are deliberate,
// so keep them out of the test output.
let warnStub: sinon.SinonStub | undefined;

function synchsafeBytes(value: number): number[] {
  return [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
}

function id3Header(tagSize: number): number[] {
  return [0x49, 0x44, 0x33, 4, 0, 0, ...synchsafeBytes(tagSize)];
}

function writeFixture(name: string, bytes: number[]): string {
  const file = path.join(tempDir, name);
  fs.writeFileSync(file, Buffer.from(bytes));
  return file;
}

describe('embedded-art', () => {
  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goon-art-test-'));
    warnStub = sinon.stub(console, 'warn');
  });

  after(() => {
    warnStub?.restore();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('files it should read', () => {
    it('returns the art from a tagged mp3', async () => {
      const art = await getEmbeddedArt(path.join(FIXTURE_DIR, 'test-01.mp3'));
      assert.equal(art?.mimeType, 'image/jpeg');
      assert.isAbove(art?.data.length ?? 0, 0);
    });

    it('returns nothing for an mp3 with a tag but no picture', async () => {
      const art = await getEmbeddedArt(path.join(FIXTURE_DIR, 'test-05 (no thumbnail).mp3'));
      assert.isUndefined(art);
    });
  });

  describe('files it should decline', () => {
    it('ignores a wav without opening it', async () => {
      assert.isUndefined(await getEmbeddedArt(path.join(FIXTURE_DIR, 'test-01.wav')));
    });

    it('ignores an extension it does not handle', async () => {
      assert.isUndefined(await getEmbeddedArt(path.join(FIXTURE_DIR, 'test-01.ogg')));
    });

    it('ignores a blob: URL', async () => {
      // Archive entries reach the media loader as blob: URLs rather than paths.
      // This is the only thing standing between them and a pointless fs call,
      // so it is checked here rather than gated at the call site.
      assert.isUndefined(await getEmbeddedArt('blob:file:///9f8e7d6c-5b4a-3210-fedc-ba9876543210'));
    });
  });

  describe('malformed and unreadable files', () => {
    it('returns nothing for a file that does not exist', async () => {
      assert.isUndefined(await getEmbeddedArt(path.join(tempDir, 'nope.mp3')));
    });

    it('returns nothing for a directory named like an mp3', async () => {
      const dir = path.join(tempDir, 'a-directory.mp3');
      fs.mkdirSync(dir, { recursive: true });
      assert.isUndefined(await getEmbeddedArt(dir));
    });

    it('returns nothing for an empty file', async () => {
      assert.isUndefined(await getEmbeddedArt(writeFixture('empty.mp3', [])));
    });

    it('returns nothing for a file shorter than an ID3 header', async () => {
      assert.isUndefined(await getEmbeddedArt(writeFixture('tiny.mp3', [0x49, 0x44, 0x33])));
    });

    it('returns nothing for a bare mp3 with no tag at all', async () => {
      // A raw MPEG frame sync, which is what an untagged mp3 starts with.
      assert.isUndefined(await getEmbeddedArt(writeFixture('untagged.mp3', [0xff, 0xfb, 0x90, 0x44, 0, 0, 0, 0, 0, 0, 0, 0])));
    });

    it('returns nothing when the tag is truncated mid-way', async () => {
      // Claims a 64KB tag, then stops after a few bytes.
      assert.isUndefined(await getEmbeddedArt(writeFixture('truncated.mp3', [...id3Header(65536), 1, 2, 3, 4])));
    });

    it('returns nothing rather than allocating an absurd tag size', async () => {
      // The largest a synchsafe size can express is ~256MB, past our cap.
      assert.isUndefined(await getEmbeddedArt(writeFixture('huge.mp3', [...id3Header(0xfffffff), 1, 2, 3, 4])));
    });

    it('returns nothing for a file of random bytes', async () => {
      const bytes: number[] = [];
      let x = 12345;
      for (let i = 0; i < 4096; ++i) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        bytes.push((x >> 16) & 0xff);
      }
      assert.isUndefined(await getEmbeddedArt(writeFixture('random.mp3', bytes)));
    });

    it('leaves no file handles open after repeated failures', async () => {
      // A leak here would only show up as EMFILE partway through a big library
      // scan, so exercise the failure path far more times than a handle table
      // would tolerate.
      const file = writeFixture('repeat.mp3', [...id3Header(65536), 1, 2, 3, 4]);
      for (let i = 0; i < 500; ++i) {
        assert.isUndefined(await getEmbeddedArt(file));
      }
    });
  });
});
