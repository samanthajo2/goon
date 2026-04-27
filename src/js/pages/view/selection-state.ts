// Global selection state for thumbnails.
// Module-level Set + pub/sub so checkbox overlays can subscribe without prop drilling.

const selected = new Set<string>();
const listeners = new Set<() => void>();

// Anchor for shift-click range selection. The "action" is what the most recent
// non-shift checkbox click did — shift-click extends that same action across a range.
type Anchor = { filename: string; action: 'select' | 'deselect' };
let anchor: Anchor | null = null;

function notify(): void {
  listeners.forEach(fn => fn());
}

export function isSelected(filename: string): boolean {
  return selected.has(filename);
}

export function getSelected(): Set<string> {
  return selected;
}

export function selectionCount(): number {
  return selected.size;
}

export function subscribeSelection(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// Toggle a single item. Updates anchor.
export function toggleSelection(filename: string): void {
  if (selected.has(filename)) {
    selected.delete(filename);
    anchor = { filename, action: 'deselect' };
  } else {
    selected.add(filename);
    anchor = { filename, action: 'select' };
  }
  notify();
}

// Shift-click extends the anchor's action across a range. If there's no
// anchor yet (or the anchor isn't in `orderedFiles`), falls back to a
// regular toggle.
export function shiftToggleSelection(filename: string, orderedFiles: string[]): void {
  if (!anchor || !orderedFiles.includes(anchor.filename)) {
    toggleSelection(filename);
    return;
  }
  const a = orderedFiles.indexOf(anchor.filename);
  const b = orderedFiles.indexOf(filename);
  if (b < 0) {
    toggleSelection(filename);
    return;
  }
  const [from, to] = a <= b ? [a, b] : [b, a];
  const range = orderedFiles.slice(from, to + 1);
  if (anchor.action === 'select') {
    range.forEach(f => selected.add(f));
  } else {
    range.forEach(f => selected.delete(f));
  }
  // Update anchor to the new endpoint, keeping the same action.
  anchor = { filename, action: anchor.action };
  notify();
}

// Bulk add (used by "select all visible"). Does not change anchor.
export function selectFiles(filenames: string[]): void {
  filenames.forEach(f => selected.add(f));
  notify();
}

export function clearSelection(): void {
  selected.clear();
  anchor = null;
  notify();
}
