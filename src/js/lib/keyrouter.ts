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

// Routes keys based on Electron-style accelerator strings.
//
// An accelerator is a '+' separated list of modifiers and a key, e.g.
//   'F6', 'CommandOrControl+A', 'Cmd+Shift+Z', 'Tab'
//
// Modifier names: Command, Cmd, Control, Ctrl, CommandOrControl, CmdOrCtrl,
// Alt, Option, Shift, Meta, Super
//
// Key names: A-Z, 0-9, F1-F24, Tab, Enter, Return, Backspace, Escape/Esc,
// Space, Insert, Delete, Up/Down/Left/Right, PageUp, PageDown, Home, End,
// punctuation: [ ] \ ; ' , . / ` - =

export type AcceleratorParts = {
  cmd: boolean;
  ctrl: boolean;
  cmdOrCtrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
};

const isMac = typeof process !== 'undefined' && process.platform === 'darwin';

// Map e.code (physical key) to the Electron-style key name.
// e.code is unaffected by shift / layout, so this gives stable matching.
const CODE_TO_KEY: Record<string, string> = {
  // Letters
  ...Object.fromEntries(
    Array.from({ length: 26 }, (_, i) => [`Key${String.fromCharCode(65 + i)}`, String.fromCharCode(65 + i)]),
  ),
  // Digits (top row)
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`Digit${i}`, String(i)]),
  ),
  // Numpad
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`Numpad${i}`, String(i)]),
  ),
  // Function keys
  ...Object.fromEntries(
    Array.from({ length: 24 }, (_, i) => [`F${i + 1}`, `F${i + 1}`]),
  ),
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Escape',
  Space: 'Space',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Slash: '/',
  Semicolon: ';',
  Quote: '\'',
  Comma: ',',
  Period: '.',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
};

// Modifier-only keys — when these are pressed with no other key, the key field
// of the accelerator is the modifier name itself (e.g. 'Shift' or 'Control').
const MODIFIER_CODES: Record<string, string> = {
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ControlLeft: 'Control',
  ControlRight: 'Control',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  MetaLeft: 'Meta',
  MetaRight: 'Meta',
};

// Normalize a token (modifier or key name) to a canonical form.
function normalizeToken(t: string): string {
  const lower = t.toLowerCase();
  switch (lower) {
    case 'cmd': case 'command': return 'Command';
    case 'ctrl': case 'control': return 'Control';
    case 'cmdorctrl': case 'commandorcontrol': return 'CommandOrControl';
    case 'alt': case 'option': return 'Alt';
    case 'shift': return 'Shift';
    case 'meta': case 'super': return 'Meta';
    case 'esc': return 'Escape';
    case 'return': return 'Enter';
    case 'space': return 'Space';
    case 'plus': return '=';
  }
  // Single letter — uppercase
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
  // Function keys — normalize case
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(t)) return t.toUpperCase();
  // Arrow keys
  if (/^(left|right|up|down)$/i.test(t)) return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  // Anything else (digits, punctuation) — keep as-is
  return t;
}

const MODIFIERS = new Set(['Command', 'Control', 'CommandOrControl', 'Alt', 'Shift', 'Meta']);

export function parseAccelerator(accel: string): AcceleratorParts {
  const tokens = accel.split('+').map(s => normalizeToken(s.trim())).filter(s => s.length > 0);
  const parts: AcceleratorParts = {
    cmd: false,
    ctrl: false,
    cmdOrCtrl: false,
    alt: false,
    shift: false,
    key: '',
  };
  for (const t of tokens) {
    if (MODIFIERS.has(t)) {
      switch (t) {
        case 'Command': case 'Meta': parts.cmd = true; break;
        case 'Control': parts.ctrl = true; break;
        case 'CommandOrControl': parts.cmdOrCtrl = true; break;
        case 'Alt': parts.alt = true; break;
        case 'Shift': parts.shift = true; break;
      }
    } else {
      parts.key = t;
    }
  }
  // Modifier-only accelerator (e.g. 'Shift', 'Control'): the lone modifier
  // is itself the key. Promote it so eventMatchesParts and isModifierOnly
  // treat it consistently with non-modifier keys.
  if (!parts.key) {
    const flagCount =
      (parts.cmd ? 1 : 0) +
      (parts.ctrl ? 1 : 0) +
      (parts.cmdOrCtrl ? 1 : 0) +
      (parts.alt ? 1 : 0) +
      (parts.shift ? 1 : 0);
    if (flagCount === 1) {
      if (parts.shift) { parts.key = 'Shift'; parts.shift = false; }
      else if (parts.ctrl) { parts.key = 'Control'; parts.ctrl = false; }
      else if (parts.alt) { parts.key = 'Alt'; parts.alt = false; }
      else if (parts.cmd) { parts.key = 'Meta'; parts.cmd = false; }
    }
  }
  return parts;
}

// Convert a KeyboardEvent into the Electron-style key name (without modifiers).
function eventKey(e: KeyboardEvent): string {
  // Modifier-only press (no other key)
  const mod = MODIFIER_CODES[e.code];
  if (mod && !e.key) return mod;
  if (mod && (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta')) {
    return mod;
  }
  return CODE_TO_KEY[e.code] ?? '';
}

// True if the KeyboardEvent matches the parsed accelerator parts.
function eventMatchesParts(e: KeyboardEvent, p: AcceleratorParts): boolean {
  const eKey = eventKey(e);
  if (eKey !== p.key) return false;
  // Match modifiers exactly. CommandOrControl matches whichever the OS uses.
  let wantCmd = p.cmd;
  let wantCtrl = p.ctrl;
  if (p.cmdOrCtrl) {
    if (isMac) wantCmd = true;
    else wantCtrl = true;
  }
  // For modifier-only accelerators (e.g. just 'Shift'), the key IS the modifier;
  // don't require the same modifier flag — pressing Shift fires shiftKey=true
  // anyway, but we don't want 'Shift' to also require shiftKey=true with Shift
  // as the key. Skip the redundant check.
  const isModifierOnly = MODIFIERS.has(p.key);
  if (!isModifierOnly) {
    if (e.metaKey !== wantCmd) return false;
    if (e.ctrlKey !== wantCtrl) return false;
    if (e.altKey !== p.alt) return false;
    if (e.shiftKey !== p.shift) return false;
  }
  return true;
}

// Returns a stable key for indexing — use the parsed parts canonical form.
function partsToKey(p: AcceleratorParts): string {
  const mods: string[] = [];
  if (p.cmdOrCtrl) mods.push('CommandOrControl');
  else {
    if (p.cmd) mods.push('Command');
    if (p.ctrl) mods.push('Control');
  }
  if (p.alt) mods.push('Alt');
  if (p.shift) mods.push('Shift');
  mods.push(p.key);
  return mods.join('+');
}

type KeyConfigEntry<T> = T & { accelerator: string };

/**
 * Routes keys based on Electron-style accelerator strings.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default class KeyRouter<T = any> {
  private entries: { parts: AcceleratorParts; config: KeyConfigEntry<T> }[] = [];

  getActionForKey(e: KeyboardEvent): KeyConfigEntry<T> | undefined {
    for (const entry of this.entries) {
      if (eventMatchesParts(e, entry.parts)) return entry.config;
    }
    return undefined;
  }

  registerKeys(keyConfig: KeyConfigEntry<T>[]): void {
    this.entries = keyConfig.map((cfg) => ({
      parts: parseAccelerator(cfg.accelerator),
      config: cfg,
    }));
  }
}

// Pretty-print an accelerator for display (used by prefs UI).
export function acceleratorToDisplay(accel: string): string {
  if (!accel) return '';
  const p = parseAccelerator(accel);
  const parts: string[] = [];
  if (p.cmdOrCtrl) parts.push(isMac ? '⌘' : 'Ctrl');
  else {
    if (p.cmd) parts.push(isMac ? '⌘' : 'Meta');
    if (p.ctrl) parts.push('Ctrl');
  }
  if (p.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (p.shift) parts.push(isMac ? '⇧' : 'Shift');
  if (p.key) parts.push(p.key);
  return parts.join(isMac ? '' : '+');
}

// Convert a KeyboardEvent into an Electron-style accelerator string.
// Used by the prefs UI when capturing user input.
export function eventToAccelerator(e: KeyboardEvent): string {
  const key = eventKey(e);
  if (!key) return '';
  // If the press is a modifier alone (no OTHER modifier held), return just
  // that modifier. The naturally-true flag for the pressed modifier itself
  // is expected — e.g. pressing Control fires ctrlKey=true.
  if (MODIFIERS.has(key)) {
    const otherModsHeld =
      (key !== 'Meta' && e.metaKey) ||
      (key !== 'Control' && e.ctrlKey) ||
      (key !== 'Alt' && e.altKey) ||
      (key !== 'Shift' && e.shiftKey);
    if (!otherModsHeld) return key;
  }
  const mods: string[] = [];
  if (e.metaKey && e.ctrlKey) mods.push('CommandOrControl');
  else if (e.metaKey) mods.push(isMac ? 'Command' : 'Meta');
  else if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey && !MODIFIERS.has(key)) mods.push('Shift');
  mods.push(key);
  return mods.join('+');
}

// Detect whether an accelerator is a modifier-only binding (e.g. just 'Shift').
export function isModifierOnly(accel: string): boolean {
  const p = parseAccelerator(accel);
  return MODIFIERS.has(p.key) && !p.cmd && !p.ctrl && !p.cmdOrCtrl && !p.alt && !p.shift;
}

// Stable id for grouping/comparing duplicate bindings (uses canonical form).
export function acceleratorToId(accel: string): string {
  return partsToKey(parseAccelerator(accel));
}
