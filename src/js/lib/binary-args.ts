/*
  Helpers for transmitting binary args (Uint8Array / ArrayBuffer / Buffer)
  over a JSON-only channel like our WebSocket bridge.

  Wire format: a single JSON metadata frame whose args may contain markers
  of the form `{__bin: N}`, immediately followed by N binary frames in
  order. The receiver replaces each marker with the matching binary
  payload before dispatching.
*/

const BIN_MARKER_KEY = '__bin';

type BinMarker = { [BIN_MARKER_KEY]: number };

function isBinMarker(v: unknown): v is BinMarker {
  return !!v && typeof v === 'object' && BIN_MARKER_KEY in (v as Record<string, unknown>)
    && typeof (v as Record<string, unknown>)[BIN_MARKER_KEY] === 'number';
}

function isBinaryValue(v: unknown): v is ArrayBuffer | ArrayBufferView {
  return v instanceof ArrayBuffer || ArrayBuffer.isView(v);
}

function toArrayBuffer(v: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (v instanceof ArrayBuffer) return v;
  // Uint8Array / Buffer / etc. — copy out the actual byte range.
  return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
}

/**
 * Walk `args` and replace any binary value with a {__bin: N} marker.
 * Returns the JSON-safe args along with the extracted binary payloads
 * (in marker-index order).
 */
export function extractBinaries(args: unknown[]): { jsonArgs: unknown[]; binaries: ArrayBuffer[] } {
  const binaries: ArrayBuffer[] = [];
  const visit = (val: unknown): unknown => {
    if (isBinaryValue(val)) {
      const idx = binaries.length;
      binaries.push(toArrayBuffer(val));
      return { [BIN_MARKER_KEY]: idx };
    }
    if (Array.isArray(val)) return val.map(visit);
    if (val && typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) out[k] = visit(v);
      return out;
    }
    return val;
  };
  return { jsonArgs: args.map(visit), binaries };
}

/**
 * Walk `args` and replace each {__bin: N} marker with binaries[N].
 * Returns the args ready for dispatch.
 */
export function inlineBinaries(args: unknown[], binaries: ArrayBuffer[]): unknown[] {
  const visit = (val: unknown): unknown => {
    if (isBinMarker(val)) return binaries[val[BIN_MARKER_KEY]];
    if (Array.isArray(val)) return val.map(visit);
    if (val && typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) out[k] = visit(v);
      return out;
    }
    return val;
  };
  return args.map(visit);
}

/**
 * Count the number of {__bin} markers reachable from args. Used by the
 * receiver to know how many binary frames to wait for.
 */
export function countBinaries(args: unknown[]): number {
  let max = -1;
  const visit = (val: unknown): void => {
    if (isBinMarker(val)) { max = Math.max(max, val[BIN_MARKER_KEY]); return; }
    if (Array.isArray(val)) { val.forEach(visit); return; }
    if (val && typeof val === 'object') Object.values(val as Record<string, unknown>).forEach(visit);
  };
  args.forEach(visit);
  return max + 1;
}
