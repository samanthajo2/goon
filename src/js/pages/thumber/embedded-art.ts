/*
  Look for artwork embedded in a media file so audio gets a real thumbnail
  instead of the generated coloured square.

  Dispatches on extension. Only mp3 (ID3v2) today; ogg/flac would be a Vorbis
  METADATA_BLOCK_PICTURE reader and m4a a 'covr' atom — both slot in here without
  the media loader having to change again.
*/

import fs from 'node:fs';
import path from 'node:path';
import {
  ID3_HEADER_SIZE,
  parseID3Header,
  parseID3Picture,
  type EmbeddedPicture,
} from '../../lib/id3.js';

// An ID3 tag sits at the front of the file and gets read whole, so cap it rather
// than trusting a corrupt size field and allocating something absurd. Real tags
// with cover art run to a few hundred KB.
const MAX_TAG_BYTES = 64 * 1024 * 1024;

// Media reaches the thumber from two places: files on disk, and archive entries
// the decompressor has already expanded into memory and exposed as a blob: URL.
// Both can be read a range at a time, which is all a tag needs.
type ByteSource = {
  // May return fewer bytes than asked for, at the end of the data.
  read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
  close(): Promise<void>;
};

async function openFileSource(filename: string): Promise<ByteSource> {
  const fh = await fs.promises.open(filename, 'r');
  return {
    async read(offset, length) {
      const bytes = new Uint8Array(length);
      const { bytesRead } = await fh.read(bytes, 0, length, offset);
      return bytesRead < length ? bytes.subarray(0, bytesRead) : bytes;
    },
    close: () => fh.close(),
  };
}

// Fetching a blob: URL hands back the Blob the thumber already holds, so this
// costs no I/O, and slicing it avoids copying the whole entry.
async function openBlobSource(url: string): Promise<ByteSource> {
  const blob = await (await fetch(url)).blob();
  return {
    async read(offset, length) {
      return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
    },
    close: async () => {},
  };
}

async function readMp3Art(source: ByteSource): Promise<EmbeddedPicture | undefined> {
  // Read the header first so we know how much of the tag to pull in; there's no
  // reason to touch the audio data that follows it.
  const headerBytes = await source.read(0, ID3_HEADER_SIZE);
  if (headerBytes.length < ID3_HEADER_SIZE) {
    return undefined;
  }
  const header = parseID3Header(headerBytes);
  if (!header || header.tagSize <= 0 || header.tagSize > MAX_TAG_BYTES) {
    return undefined;
  }
  const tagBytes = await source.read(ID3_HEADER_SIZE, header.tagSize);
  // A tag that runs past the end of the data is a truncated file.
  if (tagBytes.length < header.tagSize) {
    return undefined;
  }
  return parseID3Picture(header, tagBytes);
}

/**
 * Artwork embedded in the media at `location` — a file path, or a blob: URL for
 * an archive entry. `name` is what the format is judged by, which matters for
 * archive entries: their blob: URL carries no extension, so the entry's own name
 * has to be passed in. Returns undefined if there is no art, the format isn't
 * one we read, or anything goes wrong; callers fall back to a generated
 * thumbnail, so a failure here is never fatal.
 */
export async function getEmbeddedArt(location: string, name: string = location): Promise<EmbeddedPicture | undefined> {
  if (path.extname(name).toLowerCase() !== '.mp3') {
    return undefined;
  }
  let source: ByteSource | undefined;
  try {
    source = location.toLowerCase().startsWith('blob:')
      ? await openBlobSource(location)
      : await openFileSource(location);
    return await readMp3Art(source);
  } catch (e) {
    console.warn('could not read embedded art:', name, e);
    return undefined;
  } finally {
    await source?.close();
  }
}
