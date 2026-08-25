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

import { actions } from '../../lib/actions.js';
import { acceleratorToId, acceleratorToDisplay, isModifierOnly } from '../../lib/keyrouter.js';
import type { KeyConfig } from './default-prefs.js';

// Which standalone-modifier bindings a given accelerator would clash with. Matches
// the modifier used inside the accelerator (e.g. '⌘+Shift+=' uses Shift), but NOT
// 'CommandOrControl' — 'Control' there is part of the token, not preceded by '+'.
const modRe: Record<string, RegExp> = {
  Shift: /(^|\+)Shift\+/,
  Control: /(^|\+)Control\+/,
  Alt: /(^|\+)Alt\+/,
  Meta: /(^|\+)Meta\+/,
};

// A short, human-readable label for a binding, e.g. "⌘⇧= → Zoom In".
function label(cfg: KeyConfig): string {
  const accel = acceleratorToDisplay(cfg.accelerator) || '(unset)';
  const desc = actions[cfg.action]?.desc ?? cfg.action ?? '(no action)';
  return `${accel} → ${desc}`;
}

// For each binding in `keyConfig`, returns the list of OTHER bindings it conflicts
// with (as `label()` strings; empty = no conflict). Two kinds of conflict, and BOTH
// sides of each are always reported, so a conflict shows on every binding involved:
//
//   1. Exact duplicate — two bindings share the same canonical accelerator.
//   2. Modifier ambiguity — a modifier bound alone as a key (e.g. 'Shift') while
//      another binding uses that modifier (e.g. '⌘+Shift+='): pressing the modifier
//      is ambiguous between firing the standalone binding and being a modifier.
export function computeKeyConflicts(keyConfig: KeyConfig[]): string[][] {
  const conflicts: string[][] = keyConfig.map(() => []);

  // 1. Exact duplicates: group by canonical id; everyone in a group of ≥2 conflicts
  // with the others in that group.
  const byId: Record<string, number[]> = {};
  keyConfig.forEach((cfg, ndx) => {
    if (!cfg.accelerator) return;
    const id = acceleratorToId(cfg.accelerator);
    (byId[id] ||= []).push(ndx);
  });
  for (const idxs of Object.values(byId)) {
    if (idxs.length < 2) continue;
    for (const a of idxs) {
      for (const b of idxs) {
        if (a !== b) conflicts[a].push(label(keyConfig[b]));
      }
    }
  }

  // 2. Modifier ambiguity: map each standalone-modifier binding, then flag every
  // binding that uses that modifier — and the standalone binding — against each other.
  const standaloneMods: Record<string, number[]> = {};
  keyConfig.forEach((cfg, ndx) => {
    if (cfg.accelerator && isModifierOnly(cfg.accelerator)) {
      (standaloneMods[cfg.accelerator] ||= []).push(ndx);
    }
  });
  keyConfig.forEach((cfg, ndx) => {
    if (!cfg.accelerator || isModifierOnly(cfg.accelerator)) return;
    for (const [mod, modIdxs] of Object.entries(standaloneMods)) {
      const re = modRe[mod];
      if (re && re.test(cfg.accelerator)) {
        for (const mi of modIdxs) {
          conflicts[ndx].push(label(keyConfig[mi]));
          conflicts[mi].push(label(keyConfig[ndx]));
        }
      }
    }
  });

  return conflicts.map((list) => Array.from(new Set(list)));
}
