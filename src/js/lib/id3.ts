/*
  Minimal reader for the embedded picture (APIC) frame of an ID3v2 tag, so audio
  files can get a real thumbnail instead of a generated coloured square.

  Deliberately narrow: this looks for cover art and ignores every other frame.
  Everything here is a pure function over bytes, so it is testable without a file.

  Supports ID3v2.3 and v2.4, which is what every tagger written this century
  emits. v2.2 (3-character frame ids, 'PIC', a different picture layout) is
  recognised and skipped rather than guessed at — the caller falls back to the
  generated thumbnail, which is better than a mis-parse.

  References: https://id3.org/id3v2.3.0, https://id3.org/id3v2.4.0-structure
*/

export const ID3_HEADER_SIZE = 10;

export type ID3Header = {
  // Major version: the '3' or '4' of ID3v2.3 / ID3v2.4.
  version: number;
  flags: number;
  // Bytes of tag data following the 10-byte header.
  tagSize: number;
};

export type EmbeddedPicture = {
  mimeType: string;
  // Explicitly ArrayBuffer-backed (not SharedArrayBuffer) so callers can hand
  // this straight to a Blob.
  data: Uint8Array<ArrayBuffer>;
};

// Tag header flags.
const FLAG_UNSYNCHRONISATION = 0x80;
const FLAG_EXTENDED_HEADER = 0x40;

// Frame format flags (the second flags byte of a frame header). The bit
// positions differ between v2.3 and v2.4, hence two sets.
const V23_FRAME_FLAG_COMPRESSED = 0x80;
const V23_FRAME_FLAG_ENCRYPTED = 0x40;
const V24_FRAME_FLAG_COMPRESSED = 0x08;
const V24_FRAME_FLAG_ENCRYPTED = 0x04;
const V24_FRAME_FLAG_UNSYNCHRONISATION = 0x02;
const V24_FRAME_FLAG_DATA_LENGTH_INDICATOR = 0x01;

// 'Cover (front)' — the one to prefer when a tag carries several pictures.
const PICTURE_TYPE_FRONT_COVER = 3;

// A MIME type is short. Bounding the search keeps a malformed frame with no
// terminator from decoding megabytes of image data into a string.
const MAX_MIME_LENGTH = 64;

// APIC text encodings. 0 (ISO-8859-1) and 3 (UTF-8) terminate the description
// with a single zero byte; 1 (UTF-16 with BOM) and 2 (UTF-16BE) use two.
const ENCODING_UTF16_BOM = 1;
const ENCODING_UTF16_BE = 2;

const latin1Decoder = new TextDecoder('iso-8859-1');

// Synchsafe integers carry 7 bits per byte, leaving every high bit clear so a
// size can never contain a byte pair that looks like an MPEG frame sync. Tag
// sizes always use them; v2.4 uses them for frame sizes too, v2.3 does not.
// Reading a v2.3 frame size as synchsafe (or the reverse) doesn't fail — it
// silently walks into the middle of the data — so the version check matters.
function synchsafe(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] & 0x7f) << 21)
    | ((bytes[offset + 1] & 0x7f) << 14)
    | ((bytes[offset + 2] & 0x7f) << 7)
    | (bytes[offset + 3] & 0x7f);
}

function uint32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24)
    | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8)
    | bytes[offset + 3]) >>> 0;
}

/**
 * Parse the 10-byte tag header at the start of a file. Returns undefined if
 * these bytes aren't an ID3v2 tag at all.
 */
export function parseID3Header(bytes: Uint8Array): ID3Header | undefined {
  if (bytes.length < ID3_HEADER_SIZE) {
    return undefined;
  }
  // 'ID3'
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return undefined;
  }
  const version = bytes[3];
  // 0xff is reserved as an invalid version, and we know of nothing past 4.
  if (version < 2 || version > 4) {
    return undefined;
  }
  // The size is synchsafe, so a high bit anywhere in it means this isn't a tag
  // we can trust.
  for (let i = 6; i < ID3_HEADER_SIZE; ++i) {
    if (bytes[i] & 0x80) {
      return undefined;
    }
  }
  return { version, flags: bytes[5], tagSize: synchsafe(bytes, 6) };
}

// Unsynchronisation inserts a zero byte after every 0xff so no byte pair in the
// tag can be mistaken for an MPEG frame sync. Undo it. Cover art is full of 0xff
// bytes, so this is exactly the case where the flag tends to be set.
function deUnsynchronise(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; ++i) {
    out[n++] = bytes[i];
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) {
      ++i;
    }
  }
  return out.subarray(0, n);
}

// v2.4's extended header size is synchsafe and counts itself; v2.3's is a plain
// integer that doesn't.
function extendedHeaderSize(header: ID3Header, tag: Uint8Array): number {
  if (!(header.flags & FLAG_EXTENDED_HEADER) || tag.length < 4) {
    return 0;
  }
  return header.version >= 4 ? synchsafe(tag, 0) : uint32be(tag, 0) + 4;
}

// Real frame ids are upper-case letters and digits. Anything else means we've
// run off the end of the frames into padding or garbage.
function isFrameId(bytes: Uint8Array, offset: number): boolean {
  for (let i = offset; i < offset + 4; ++i) {
    const c = bytes[i];
    if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39))) {
      return false;
    }
  }
  return true;
}

// Compressed or encrypted frames would need zlib or a key we don't have.
function isFrameReadable(version: number, formatFlags: number): boolean {
  const mask = version >= 4
    ? V24_FRAME_FLAG_COMPRESSED | V24_FRAME_FLAG_ENCRYPTED
    : V23_FRAME_FLAG_COMPRESSED | V23_FRAME_FLAG_ENCRYPTED;
  return (formatFlags & mask) === 0;
}

// Find the byte after the APIC description. This is the step naive parsers get
// wrong: the terminator is one zero byte for the single-byte encodings but two
// for the UTF-16 ones, where it also has to land on an even offset from the
// description's start.
function skipDescription(frame: Uint8Array, start: number, encoding: number): number {
  if (encoding === ENCODING_UTF16_BOM || encoding === ENCODING_UTF16_BE) {
    for (let i = start; i + 1 < frame.length; i += 2) {
      if (frame[i] === 0 && frame[i + 1] === 0) {
        return i + 2;
      }
    }
    return -1;
  }
  const end = frame.indexOf(0, start);
  return end < 0 ? -1 : end + 1;
}

// Taggers are loose here: bare 'JPG'/'PNG' and the non-standard 'image/jpg' all
// turn up in the wild, and a blob with a bogus type won't decode.
function normaliseMimeType(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower === 'jpg' || lower === 'jpeg' || lower === 'image/jpg') {
    return 'image/jpeg';
  }
  if (lower === 'png') {
    return 'image/png';
  }
  return lower;
}

// APIC layout: encoding byte, NUL-terminated MIME, picture-type byte,
// description terminated per the encoding, then the image bytes.
function parseApicFrame(frame: Uint8Array<ArrayBuffer>): { pictureType: number; picture: EmbeddedPicture } | undefined {
  if (frame.length < 4) {
    return undefined;
  }
  const encoding = frame[0];

  const mimeSearchEnd = Math.min(frame.length, 1 + MAX_MIME_LENGTH);
  let mimeEnd = -1;
  for (let i = 1; i < mimeSearchEnd; ++i) {
    if (frame[i] === 0) {
      mimeEnd = i;
      break;
    }
  }
  if (mimeEnd < 0) {
    return undefined;
  }
  const mimeType = latin1Decoder.decode(frame.subarray(1, mimeEnd));
  // '-->' means the frame holds a URL to the image rather than the image itself.
  if (!mimeType || mimeType === '-->') {
    return undefined;
  }

  const pictureTypeOffset = mimeEnd + 1;
  if (pictureTypeOffset >= frame.length) {
    return undefined;
  }
  const pictureType = frame[pictureTypeOffset];

  const dataStart = skipDescription(frame, pictureTypeOffset + 1, encoding);
  if (dataStart < 0 || dataStart >= frame.length) {
    return undefined;
  }

  return {
    pictureType,
    picture: {
      mimeType: normaliseMimeType(mimeType),
      data: frame.subarray(dataStart),
    },
  };
}

/**
 * Find the cover art in the tag body (the `header.tagSize` bytes that follow the
 * 10-byte header). Prefers a front cover; falls back to the first usable picture
 * of any type. Returns undefined when there is none we can read.
 */
export function parseID3Picture(header: ID3Header, tagBytes: Uint8Array<ArrayBuffer>): EmbeddedPicture | undefined {
  // v2.2 uses 3-character frame ids and a different picture frame layout.
  if (header.version < 3) {
    return undefined;
  }

  // v2.3 sets one flag for the whole tag, v2.4 a flag per frame -- but in both
  // cases a frame's stored size counts the bytes *as unsynchronised on disk*.
  // So the tag can't be decoded up front: that would shorten it while leaving
  // every frame size describing the longer form, walking the parse off into the
  // middle of the data. Decode each frame's payload instead, after using its
  // size to find it.
  const tagUnsynchronised = header.version === 3 && !!(header.flags & FLAG_UNSYNCHRONISATION);
  const tag = tagBytes;

  let pos = extendedHeaderSize(header, tag);
  let fallback: EmbeddedPicture | undefined;

  while (pos + ID3_HEADER_SIZE <= tag.length) {
    // The tag is zero-padded once the frames run out.
    if (!isFrameId(tag, pos)) {
      break;
    }
    const id = latin1Decoder.decode(tag.subarray(pos, pos + 4));
    const size = header.version >= 4 ? synchsafe(tag, pos + 4) : uint32be(tag, pos + 4);
    const formatFlags = tag[pos + 9];
    const dataStart = pos + ID3_HEADER_SIZE;
    if (size <= 0 || dataStart + size > tag.length) {
      break;
    }

    if (id === 'APIC' && isFrameReadable(header.version, formatFlags)) {
      let data = tag.subarray(dataStart, dataStart + size);
      if (header.version >= 4) {
        if (formatFlags & V24_FRAME_FLAG_DATA_LENGTH_INDICATOR) {
          // A four-byte synchsafe decoded-size prefix we don't need.
          data = data.subarray(4);
        }
        if (formatFlags & V24_FRAME_FLAG_UNSYNCHRONISATION) {
          data = deUnsynchronise(data);
        }
      } else if (tagUnsynchronised) {
        data = deUnsynchronise(data);
      }
      const found = parseApicFrame(data);
      if (found && found.picture.data.length > 0) {
        if (found.pictureType === PICTURE_TYPE_FRONT_COVER) {
          return found.picture;
        }
        fallback = fallback ?? found.picture;
      }
    }
    pos = dataStart + size;
  }

  return fallback;
}
