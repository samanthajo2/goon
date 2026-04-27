/*
  Look up the menu accelerator for a given action from the user's keyConfig.

  keyConfig stores Electron-style accelerator strings already, so this just
  picks the best binding for the host OS.
*/

import { KeyConfig } from '../pages/prefs/default-prefs.js';
import { parseAccelerator } from '../lib/keyrouter.js';
import type { ActionId } from '../lib/actions.js';

const isMac = process.platform === 'darwin';

// Modifier-only accelerators (just 'Shift', 'Control', etc.) can't be used as
// menu accelerators — Electron requires a non-modifier key.
const MODIFIERS = new Set(['Command', 'Control', 'CommandOrControl', 'Alt', 'Shift', 'Meta']);

function isMenuable(accel: string): boolean {
  const p = parseAccelerator(accel);
  return !!p.key && !MODIFIERS.has(p.key);
}

// Score a binding for "best fit on this OS":
//  - CommandOrControl wins
//  - On Mac, Command beats Control
//  - On Windows/Linux, Control beats Command
//  - Bindings with modifiers beat bare keys (more discoverable in menus)
function scoreBinding(accel: string): number {
  const p = parseAccelerator(accel);
  let score = 0;
  if (p.cmdOrCtrl) score += 10;
  else if (isMac) {
    if (p.cmd) score += 8;
    if (p.ctrl) score += 2;
  } else {
    if (p.ctrl) score += 8;
    if (p.cmd) score += 2;
  }
  if (p.alt) score += 1;
  if (p.shift) score += 1;
  // Prefer something with at least one modifier
  if (p.cmd || p.ctrl || p.cmdOrCtrl || p.alt || p.shift) score += 5;
  return score;
}

export function actionAccelerator(actionId: ActionId, keyConfig: KeyConfig[]): string | undefined {
  const matches = keyConfig.filter(k => k.action === actionId && isMenuable(k.accelerator));
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0].accelerator;
  // Pick highest-scoring binding for this OS
  let best = matches[0];
  let bestScore = scoreBinding(best.accelerator);
  for (let i = 1; i < matches.length; i++) {
    const s = scoreBinding(matches[i].accelerator);
    if (s > bestScore) {
      best = matches[i];
      bestScore = s;
    }
  }
  return best.accelerator;
}
