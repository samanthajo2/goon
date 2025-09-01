

// ---- Minimal MP4 title/comment extractor (TypeScript) ----
import { readFile } from 'node:fs/promises';
import { Blob } from 'node:buffer';

const tdAscii = new TextDecoder('ascii');
const tdUtf8 = new TextDecoder('utf-8');
const tdUtf16BE = new TextDecoder('utf-16be');

function be16(v: DataView, o: number): number {
  return v.getUint16(o, false);
}
function be32(v: DataView, o: number): number {
  return v.getUint32(o, false);
}
function be64(v: DataView, o: number): bigint {
  if (typeof v.getBigUint64 === 'function') {
    return v.getBigUint64(o, false);
  }
  const hi = BigInt(be32(v, o));
  const lo = BigInt(be32(v, o + 4));
  return (hi << 32n) + lo;
}
function ascii(v: DataView, o: number, l: number): string {
  return tdAscii.decode(new Uint8Array(v.buffer, v.byteOffset + o, l));
}

async function readRange(blob: Blob, startBig: bigint, len: number): Promise<DataView> {
  const slice = blob.slice(Number(startBig), Number(startBig) + len);
  return new DataView(await slice.arrayBuffer());
}

const fourCCfromCode = (() => {
  const bytes = new Uint8Array(4);
  return function fourCCfromCode(code: number): string {
    bytes[0] = (code >>> 24) & 0xff;
    bytes[1] = (code >>> 16) & 0xff;
    bytes[2] = (code >>> 8) & 0xff;
    bytes[3] = code & 0xff;
    return tdAscii.decode(bytes);
  };
})();

interface Mp4BoxHeader {
  type: string;
  typeCode: number;
  size: bigint;
  headerBytes: number;
  start: bigint;
  contentStart: bigint;
}

async function readBoxHeader(blob: Blob, start: bigint): Promise<Mp4BoxHeader | null> {
  const end = BigInt(blob.size);
  if (start + 8n > end) {
    return null;
  }
  let dv = await readRange(blob, start, 8);
  let size = BigInt(be32(dv, 0));
  const typeCode = be32(dv, 4);
  const type = fourCCfromCode(typeCode);
  let headerBytes = 8;

  if (size === 1n) {
    dv = await readRange(blob, start, 16);
    size = be64(dv, 8);
    headerBytes = 16;
  }
  if (type === 'uuid') {
    headerBytes += 16;
  }
  if (size === 0n) {
    size = end - start; // to EOF (top-level)
  }
  if (size < BigInt(headerBytes)) {
    return null;
  }

  return {
    type,
    typeCode,
    size,
    headerBytes,
    start,
    contentStart: start + BigInt(headerBytes)
  };
}

async function* iterateBoxes(blob: Blob, start: bigint = 0n, end: bigint = BigInt(blob.size)):
  AsyncGenerator<Mp4BoxHeader, void, unknown> {
  let off = start;
  while (off + 8n <= end) {
    const h = await readBoxHeader(blob, off);
    if (!h) {
      break;
    }
    yield h;
    const next = off + h.size;
    if (next <= off) {
      break; // corrupted
    }
    off = next;
  }
}

async function* iterateChildren(blob: Blob, parent: Mp4BoxHeader, contentSkip: bigint = 0n):
  AsyncGenerator<Mp4BoxHeader, void, unknown> {
  const start = parent.contentStart + contentSkip;
  const end = parent.start + parent.size;
  yield* iterateBoxes(blob, start, end);
}

// ---- Helpers to decode ilst/data/freeform/keys ----

// iTunes 'data' box usually has: version(1) + flags(3) [flags = type], then 4 bytes reserved, then payload.
// Some files use "type + locale" for the first 8 bytes. Handle both.
function decodeIlstDataPayload(dv: DataView): string {
  if (dv.byteLength < 4) {
    return '';
  }
  const version = dv.getUint8(0);
  const flags = (dv.getUint8(1) << 16) | (dv.getUint8(2) << 8) | dv.getUint8(3);
  const reserved = dv.byteLength >= 8 ? be32(dv, 4) : 0;

  const [dataType, payloadOff] = (version === 0 && dv.byteLength >= 8 && (reserved === 0 || reserved === 0x00000000))
    ? [flags, 8] // 'fullbox + reserved' layout
    : [be32(dv, 0), 8]; // 'type + locale' layout

  const bytes = new Uint8Array(dv.buffer, dv.byteOffset + payloadOff, dv.byteLength - payloadOff);
  if (dataType === 1) {
    // UTF-8
    return tdUtf8.decode(bytes).replace(/\0+$/, '');
  } else if (dataType === 2) {
    // UTF-16BE
    return tdUtf16BE.decode(bytes).replace(/\0+$/, '');
  } else {
    // Try UTF-8 as a best-effort
    return tdUtf8.decode(bytes).replace(/\0+$/, '');
  }
}

async function readFirstDataString(blob: Blob, itemBox: Mp4BoxHeader): Promise<string> {
  for await (const child of iterateChildren(blob, itemBox)) {
    if (child.type === 'data') {
      const dv = await readRange(blob, child.contentStart, Number(child.size - BigInt(child.headerBytes)));
      return decodeIlstDataPayload(dv).trim();
    }
  }
  return '';
}

interface FreeformItem {
  mean: string;
  name: string;
  value: string;
}

// Parse freeform iTunes '----' item: contains 'mean', 'name', and one/more 'data'
async function parseFreeformItem(blob: Blob, itemBox: Mp4BoxHeader): Promise<FreeformItem> {
  let mean = '';
  let name = '';
  let value = '';
  for await (const child of iterateChildren(blob, itemBox)) {
    if (child.type === 'mean' || child.type === 'name') {
      const dv = await readRange(blob, child.contentStart, Number(child.size - BigInt(child.headerBytes)));
      // These boxes are FullBoxes; skip version+flags (4 bytes) if present
      const off = (dv.byteLength >= 4) ? 4: 0;
      const str = tdUtf8.decode(new Uint8Array(dv.buffer, dv.byteOffset + off, dv.byteLength - off)).trim();
      if (child.type === 'mean') {
        mean = str;
      } else {
        name = str;
      }
    } else if (child.type === 'data' && !value) {
      const dv = await readRange(blob, child.contentStart, Number(child.size - BigInt(child.headerBytes)));
      value = decodeIlstDataPayload(dv).trim();
    }
  }
  return { mean, name, value };
}

// Parse QuickTime 'keys' box => 1-based array of key names
async function parseKeysBox(blob: Blob, keysBox: Mp4BoxHeader): Promise<string[]> {
  const dv = await readRange(blob, keysBox.contentStart, Number(keysBox.size - BigInt(keysBox.headerBytes)));
  if (dv.byteLength < 8) {
    return [];
  }
  let off = 0;
  // version + flags
  off += 4;
  const count = be32(dv, off);
  off += 4;
  const keys: string[] = [];
  for (let i = 1; i <= count; i++) {
    if (off + 8 > dv.byteLength) {
      break;
    }
    const keySize = be32(dv, off);
    const ns = ascii(dv, off + 4, 4); // e.g., 'mdta'
    const valBytes = keySize - 8;
    const val = tdUtf8.decode(new Uint8Array(dv.buffer, dv.byteOffset + off + 8, valBytes));
    keys[i] = (ns ? ns + ':' : '') + val;
    off += keySize;
  }
  return keys;
}

export interface TitleComment {
  title: string | null;
  comment: string | null;
}

// Given an 'ilst' box (and optional keys), pull title/comment
async function parseIlstTitleComment(blob: Blob, ilstBox: Mp4BoxHeader, keysMap?: string[]): Promise<TitleComment> {
  const out: TitleComment = { title: null, comment: null };

  for await (const item of iterateChildren(blob, ilstBox)) {
    // (A) Common iTunes atoms
    if (item.type === '©nam' && !out.title) {
      out.title = await readFirstDataString(blob, item);
    } else if (item.type === '©cmt' && !out.comment) {
      out.comment = await readFirstDataString(blob, item);
    }
    // (B) Freeform '----' (mean/name/data)
    else if (item.type === '----') {
      const ff = await parseFreeformItem(blob, item);
      const key = (ff.mean + ':' + ff.name).toLowerCase();
      if (!out.title && (ff.name.toLowerCase() === 'title' || key.includes('quicktime:title') || key.includes('itunes:title'))) {
        out.title = ff.value || out.title;
      }
      if (!out.comment && (ff.name.toLowerCase() === 'comment' || key.includes('quicktime:comment') || key.includes('itunes:comment'))) {
        out.comment = ff.value || out.comment;
      }
    }
    // (C) QuickTime 'keys' mapping — ilst children may have a numeric 4CC (contains NULs)
    else if (item.type.includes('\u0000') && keysMap && keysMap.length) {
      const keyId = item.typeCode >>> 0; // uint32
      const keyName = (keysMap[keyId] || '').toLowerCase();
      if (keyName) {
        const val = await readFirstDataString(blob, item);
        if (!out.title && (keyName.endsWith('title') || keyName.includes('quicktime:title'))) {
          out.title = val || out.title;
        }
        if (!out.comment && (keyName.endsWith('comment') || keyName.includes('quicktime:comment'))) {
          out.comment = val || out.comment;
        }
      }
    }

    if (out.title && out.comment) {
      break;
    }
  }

  return out;
}

// Find all meta/ilst containers we care about and try them in order
async function extractMetaData(blob: Blob): Promise<TitleComment> {
  const found: TitleComment = { title: null, comment: null };

  for await (const top of iterateBoxes(blob)) {
    if (top.type !== 'moov') {
      continue;
    }

    // Search both moov/meta and moov/udta/meta
    const metaBoxes: Mp4BoxHeader[] = [];
    for await (const c of iterateChildren(blob, top)) {
      if (c.type === 'meta') {
        metaBoxes.push(c);
      }
      if (c.type === 'udta') {
        for await (const u of iterateChildren(blob, c)) {
          if (u.type === 'meta') {
            metaBoxes.push(u);
          }
        }
      }
    }

    for (const meta of metaBoxes) {
      // 'meta' is a FullBox => children start after 4 bytes (version+flags)
      let keysMap: string[] = [];
      let ilstBox: Mp4BoxHeader | null = null;

      for await (const mchild of iterateChildren(blob, meta, 4n)) {
        if (mchild.type === 'keys') {
          keysMap = await parseKeysBox(blob, mchild);
        }
        if (mchild.type === 'ilst') {
          ilstBox = mchild;
        }
      }

      if (ilstBox) {
        const part = await parseIlstTitleComment(blob, ilstBox, keysMap);
        found.title = found.title || part.title;
        found.comment = found.comment || part.comment;
        if (found.title && found.comment) {
          return found;
        }
      }
    }
  }
  return found; // may be nulls if not present
}

export async function extractData(filename: string) {
  const data = await readFile(filename);
  const blob = new Blob([data], { type: "application/octet-stream" });
  return await extractMetaData(blob);
}
