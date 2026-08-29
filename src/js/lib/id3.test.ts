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
import path from 'node:path';
import { describe, it } from './test/mocha.js';
import { assert } from 'chai';
import { ID3_HEADER_SIZE, parseID3Header, parseID3Picture, type ID3Header } from './id3.js';

// Compiled tests live at out/js/src/js/lib/, so the repo root is five up — the
// same idiom main.ts uses to find app/.
const REPO_ROOT = path.join(import.meta.dirname, '..', '..', '..', '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'test', 'data', 'audio');

const JPEG_SOI = [0xff, 0xd8, 0xff, 0xe0];

// Leading and trailing bytes every file of the type must have: JPEG's SOI/EOI
// markers, and PNG's signature and the CRC of its terminating IEND chunk.
const FILE_MAGIC: Record<string, { start: number[]; end: number[] }> = {
  'image/jpeg': { start: [0xff, 0xd8], end: [0xff, 0xd9] },
  'image/png': { start: [0x89, 0x50, 0x4e, 0x47], end: [0xae, 0x42, 0x60, 0x82] },
};

// ---------- builders ----------

function synchsafeBytes(value: number): number[] {
  return [
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ];
}

function uint32beBytes(value: number): number[] {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function latin1Bytes(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

type ApicOptions = {
  encoding?: number;
  mimeType?: string;
  pictureType?: number;
  // Raw bytes of the description, terminator excluded.
  description?: number[];
  data?: number[];
};

// The APIC payload: encoding, NUL-terminated MIME, picture type, terminated
// description, image bytes.
function apicPayload(options: ApicOptions = {}): number[] {
  const encoding = options.encoding ?? 3;
  const description = options.description ?? [];
  const terminator = (encoding === 1 || encoding === 2) ? [0, 0] : [0];
  return [
    encoding,
    ...latin1Bytes(options.mimeType ?? 'image/jpeg'), 0,
    options.pictureType ?? 3,
    ...description, ...terminator,
    ...(options.data ?? JPEG_SOI),
  ];
}

type FrameOptions = {
  id?: string;
  formatFlags?: number;
  // Bytes placed in front of the payload, e.g. a v2.4 data-length indicator.
  prefix?: number[];
};

function frame(version: number, payload: number[], options: FrameOptions = {}): number[] {
  const body = [...(options.prefix ?? []), ...payload];
  const size = version >= 4 ? synchsafeBytes(body.length) : uint32beBytes(body.length);
  return [
    ...latin1Bytes(options.id ?? 'APIC'),
    ...size,
    0, options.formatFlags ?? 0,
    ...body,
  ];
}

function tag(version: number, frames: number[], flags = 0): { header: ID3Header; bytes: Uint8Array<ArrayBuffer> } {
  return {
    header: { version, flags, tagSize: frames.length },
    bytes: new Uint8Array(frames),
  };
}

function findPicture(version: number, frames: number[], flags = 0) {
  const t = tag(version, frames, flags);
  return parseID3Picture(t.header, t.bytes);
}

// ---------- tests ----------

describe('id3', () => {
  describe('parseID3Header', () => {
    it('reads a v2.4 header', () => {
      const header = parseID3Header(new Uint8Array([
        ...latin1Bytes('ID3'), 4, 0, 0, ...synchsafeBytes(1234),
      ]));
      assert.deepEqual(header, { version: 4, flags: 0, tagSize: 1234 });
    });

    it('decodes the size as synchsafe, not plain', () => {
      // 0x00 0x00 0x02 0x01 is 257 plain but 0x81 = 129 synchsafe.
      const header = parseID3Header(new Uint8Array([
        ...latin1Bytes('ID3'), 3, 0, 0, 0, 0, 0x02, 0x01,
      ]));
      assert.equal(header?.tagSize, (2 << 7) | 1);
    });

    it('rejects a file with no ID3 magic', () => {
      const header = parseID3Header(new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0, 0, 0, 0, 0, 0]));
      assert.isUndefined(header);
    });

    it('rejects a size with a high bit set', () => {
      const header = parseID3Header(new Uint8Array([
        ...latin1Bytes('ID3'), 4, 0, 0, 0, 0, 0x80, 0,
      ]));
      assert.isUndefined(header);
    });

    it('rejects a truncated header', () => {
      assert.isUndefined(parseID3Header(new Uint8Array([...latin1Bytes('ID3'), 4, 0])));
    });
  });

  describe('parseID3Picture', () => {
    it('finds cover art in a v2.4 tag', () => {
      const picture = findPicture(4, frame(4, apicPayload()));
      assert.equal(picture?.mimeType, 'image/jpeg');
      assert.deepEqual([...(picture?.data ?? [])], JPEG_SOI);
    });

    it('finds cover art in a v2.3 tag', () => {
      // v2.3 sizes are plain big-endian; reading them as synchsafe would land
      // mid-payload rather than fail outright.
      const picture = findPicture(3, frame(3, apicPayload()));
      assert.deepEqual([...(picture?.data ?? [])], JPEG_SOI);
    });

    it('skips over a leading non-picture frame', () => {
      const frames = [
        ...frame(4, [3, ...latin1Bytes('Some Title'), 0], { id: 'TIT2' }),
        ...frame(4, apicPayload()),
      ];
      assert.deepEqual([...(findPicture(4, frames)?.data ?? [])], JPEG_SOI);
    });

    it('handles a non-empty description', () => {
      const payload = apicPayload({ description: latin1Bytes('Front cover') });
      assert.deepEqual([...(findPicture(4, frame(4, payload))?.data ?? [])], JPEG_SOI);
    });

    it('handles a UTF-16 description, which terminates with two zero bytes', () => {
      // 'Hi' in UTF-16LE with a BOM. A single-NUL scan would stop inside it and
      // treat the rest of the text as image data.
      const payload = apicPayload({
        encoding: 1,
        description: [0xff, 0xfe, 0x48, 0x00, 0x69, 0x00],
      });
      assert.deepEqual([...(findPicture(4, frame(4, payload))?.data ?? [])], JPEG_SOI);
    });

    it('prefers the front cover over other picture types', () => {
      const frames = [
        ...frame(4, apicPayload({ pictureType: 4, data: [1, 1, 1, 1] })),
        ...frame(4, apicPayload({ pictureType: 3, data: JPEG_SOI })),
      ];
      assert.deepEqual([...(findPicture(4, frames)?.data ?? [])], JPEG_SOI);
    });

    it('falls back to the first picture when there is no front cover', () => {
      const frames = [
        ...frame(4, apicPayload({ pictureType: 4, data: [1, 1, 1, 1] })),
        ...frame(4, apicPayload({ pictureType: 5, data: [2, 2, 2, 2] })),
      ];
      assert.deepEqual([...(findPicture(4, frames)?.data ?? [])], [1, 1, 1, 1]);
    });

    it('skips a v2.4 data-length indicator', () => {
      const payload = apicPayload();
      const frames = frame(4, payload, {
        formatFlags: 0x01,
        prefix: synchsafeBytes(payload.length),
      });
      assert.deepEqual([...(findPicture(4, frames)?.data ?? [])], JPEG_SOI);
    });

    it('undoes per-frame unsynchronisation in v2.4', () => {
      // 0xff 0x00 0xd8 on the wire decodes back to the 0xff 0xd8 of a JPEG SOI.
      const payload = apicPayload({ data: [0xff, 0x00, 0xd8, 0xff, 0x00, 0xe0] });
      const frames = frame(4, payload, { formatFlags: 0x02 });
      assert.deepEqual([...(findPicture(4, frames)?.data ?? [])], [0xff, 0xd8, 0xff, 0xe0]);
    });

    it('undoes whole-tag unsynchronisation in v2.3', () => {
      const payload = apicPayload({ data: [0xff, 0x00, 0xd8, 0xff, 0x00, 0xe0] });
      // The tag size covers the unsynchronised bytes, so build the frame around
      // the encoded length and let the parser shorten it.
      const frames = frame(3, payload);
      assert.deepEqual([...(findPicture(3, frames, 0x80)?.data ?? [])], [0xff, 0xd8, 0xff, 0xe0]);
    });

    it('normalises sloppy mime types', () => {
      assert.equal(findPicture(4, frame(4, apicPayload({ mimeType: 'image/jpg' })))?.mimeType, 'image/jpeg');
      assert.equal(findPicture(4, frame(4, apicPayload({ mimeType: 'PNG' })))?.mimeType, 'image/png');
    });

    it('ignores a picture stored as a URL', () => {
      assert.isUndefined(findPicture(4, frame(4, apicPayload({ mimeType: '-->' }))));
    });

    it('ignores a compressed frame it cannot inflate', () => {
      assert.isUndefined(findPicture(4, frame(4, apicPayload(), { formatFlags: 0x08 })));
    });

    it('returns nothing for a tag with no picture', () => {
      const frames = frame(4, [3, ...latin1Bytes('Some Title'), 0], { id: 'TIT2' });
      assert.isUndefined(findPicture(4, frames));
    });

    it('stops at padding rather than reading zeros as a frame', () => {
      const frames = [...frame(4, apicPayload()), ...new Array(64).fill(0)];
      assert.deepEqual([...(findPicture(4, frames)?.data ?? [])], JPEG_SOI);
    });

    it('skips v2.2 rather than guessing at its layout', () => {
      assert.isUndefined(findPicture(2, frame(2, apicPayload(), { id: 'PIC' })));
    });

    it('does not run off the end of a frame whose size is a lie', () => {
      const frames = frame(4, apicPayload());
      // Claim far more data than the tag holds.
      frames[4] = 0x7f;
      frames[5] = 0x7f;
      assert.isUndefined(findPicture(4, frames));
    });
  });

  // A thumbnail run walks whatever is on disk, so the parser has to treat every
  // byte sequence as hostile: never throw, never hang, never over-read. Failing
  // to find a picture is always an acceptable answer.
  describe('malformed input', () => {
    // Deterministic so a failure is reproducible.
    function pseudoRandomBytes(count: number, seed: number): Uint8Array<ArrayBuffer> {
      const out = new Uint8Array(count);
      let x = seed;
      for (let i = 0; i < count; ++i) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        out[i] = (x >> 16) & 0xff;
      }
      return out;
    }

    function parseAnything(version: number, bytes: Uint8Array<ArrayBuffer>, flags = 0) {
      return parseID3Picture({ version, flags, tagSize: bytes.length }, bytes);
    }

    it('survives random bytes at every version', () => {
      for (let seed = 1; seed <= 200; ++seed) {
        const bytes = pseudoRandomBytes(256, seed);
        for (const version of [2, 3, 4]) {
          for (const flags of [0, 0x80, 0x40, 0xc0]) {
            assert.doesNotThrow(() => parseAnything(version, bytes, flags), `seed ${seed} v${version} flags ${flags}`);
          }
        }
      }
    });

    it('survives a valid tag truncated at every length', () => {
      const full = new Uint8Array(frame(4, apicPayload({ description: latin1Bytes('cover') })));
      for (let length = 0; length <= full.length; ++length) {
        assert.doesNotThrow(() => parseAnything(4, full.slice(0, length)), `truncated to ${length}`);
      }
    });

    it('survives every single-byte corruption of a valid tag', () => {
      const full = new Uint8Array(frame(4, apicPayload({ description: latin1Bytes('cover') })));
      for (let i = 0; i < full.length; ++i) {
        for (const value of [0x00, 0x01, 0x7f, 0x80, 0xff]) {
          const corrupted = full.slice();
          corrupted[i] = value;
          assert.doesNotThrow(() => parseAnything(4, corrupted), `byte ${i} = ${value}`);
        }
      }
    });

    it('terminates on a frame that claims zero length', () => {
      // A zero size would leave `pos` unmoved and spin forever if it weren't
      // treated as the end of the frames.
      const bytes = new Uint8Array([...latin1Bytes('APIC'), 0, 0, 0, 0, 0, 0, ...apicPayload()]);
      assert.isUndefined(parseAnything(4, bytes));
    });

    it('rejects an extended header that runs past the tag', () => {
      const bytes = new Uint8Array([0x7f, 0x7f, 0x7f, 0x7f, ...frame(4, apicPayload())]);
      assert.isUndefined(parseAnything(4, bytes, 0x40));
    });

    it('gives up on an unterminated mime type instead of decoding the whole frame', () => {
      // No NUL anywhere: every byte after the encoding byte looks like mime.
      const payload = [3, ...new Array(4096).fill(0x41)];
      assert.isUndefined(parseAnything(4, new Uint8Array(frame(4, payload))));
    });

    it('handles a frame whose data length indicator eats the whole payload', () => {
      const bytes = new Uint8Array(frame(4, [1, 2], { formatFlags: 0x01 }));
      assert.doesNotThrow(() => parseAnything(4, bytes));
    });

    it('survives a truncated real file', () => {
      const file = fs.readFileSync(path.join(FIXTURE_DIR, 'test-01.mp3'));
      const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
      const header = parseID3Header(bytes);
      assert.isDefined(header);
      // Cut the tag short at a spread of points, as a partial download would.
      for (const fraction of [0, 0.01, 0.1, 0.5, 0.9, 0.99]) {
        const length = Math.floor(header!.tagSize * fraction);
        assert.doesNotThrow(
          () => parseID3Picture(header!, bytes.slice(ID3_HEADER_SIZE, ID3_HEADER_SIZE + length)),
          `cut at ${fraction}`,
        );
      }
    });

    it('does not mistake a wav for a tagged mp3', () => {
      const file = fs.readFileSync(path.join(FIXTURE_DIR, 'test-01.wav'));
      const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
      assert.isUndefined(parseID3Header(bytes));
    });
  });

  describe('real files', () => {
    const fixtures = fs.existsSync(FIXTURE_DIR)
      ? fs.readdirSync(FIXTURE_DIR).filter((f) => f.toLowerCase().endsWith('.mp3')).sort()
      : [];

    it('has mp3 fixtures to read', () => {
      assert.isAbove(fixtures.length, 0, `no .mp3 files in ${FIXTURE_DIR}`);
    });

    for (const name of fixtures) {
      // Fixtures marked '(no thumbnail)' have a tag but no picture in it, which
      // is the case that has to fall back to the generated image.
      const expectPicture = !name.includes('no thumbnail');
      const what = expectPicture ? 'extracts a whole, decodable image from' : 'finds no picture in';

      it(`${what} ${name}`, () => {
        const file = fs.readFileSync(path.join(FIXTURE_DIR, name));
        const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
        const header = parseID3Header(bytes);
        const picture = header
          ? parseID3Picture(header, bytes.slice(ID3_HEADER_SIZE, ID3_HEADER_SIZE + header.tagSize))
          : undefined;

        if (!expectPicture) {
          assert.isUndefined(picture, 'expected no embedded picture');
          return;
        }
        assert.isDefined(header, 'no ID3 header');
        assert.isDefined(picture, 'no embedded picture');

        const magic = FILE_MAGIC[picture!.mimeType];
        assert.isDefined(magic, `unexpected mime type ${picture!.mimeType}`);
        // Checking both ends is what catches an off-by-a-few: a description or
        // frame-size mis-parse shifts the start, and an over-long size runs past
        // the terminator into the audio data.
        assert.deepEqual([...picture!.data.subarray(0, magic.start.length)], magic.start, 'wrong start-of-file magic');
        assert.deepEqual([...picture!.data.subarray(picture!.data.length - magic.end.length)], magic.end, 'wrong end-of-file magic');
      });
    }
  });
});
