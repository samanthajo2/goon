// Global selection state for thumbnails.
// Module-level Set + pub/sub so checkbox overlays can subscribe without prop drilling.
//
// Selection is keyed by ENTRY, not by filename. An entry is a (folderKey, filename)
// pair: the same file can appear under more than one folder row (its real folder plus
// any virtual folders that reference it), and each appearance selects independently.
// Today every file lives in exactly one folder, so this behaves identically to a
// filename-keyed set — the entry model is what makes virtual folders work later.

export type SelectionEntry = { folderKey: string; filename: string };

// Composite key. NUL can't appear in a path or a folder key, so it's a safe separator.
const SEP = '\u0000';
function entryId(folderKey: string, filename: string): string {
  return `${folderKey}${SEP}${filename}`;
}
function splitId(id: string): SelectionEntry {
  const i = id.indexOf(SEP);
  return { folderKey: id.slice(0, i), filename: id.slice(i + 1) };
}

const selected = new Set<string>();
const listeners = new Set<() => void>();

// Anchor for shift-click range selection. The "action" is what the most recent
// non-shift checkbox click did — shift-click extends that same action across a range.
type Anchor = { id: string; action: 'select' | 'deselect' };
let anchor: Anchor | null = null;

function notify(): void {
  listeners.forEach(fn => fn());
}

export function isSelected(folderKey: string, filename: string): boolean {
  return selected.has(entryId(folderKey, filename));
}

export function getSelectedEntries(): SelectionEntry[] {
  return Array.from(selected, splitId);
}

// Unique filenames across the selection — used where only the file paths matter
// (e.g. dragging out to Finder/Explorer), independent of which folder rows they're in.
export function getSelectedFilenames(): string[] {
  return Array.from(new Set(Array.from(selected, id => splitId(id).filename)));
}

export function selectionCount(): number {
  return selected.size;
}

export function subscribeSelection(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function toggleId(id: string): void {
  if (selected.has(id)) {
    selected.delete(id);
    anchor = { id, action: 'deselect' };
  } else {
    selected.add(id);
    anchor = { id, action: 'select' };
  }
  notify();
}

// Toggle a single entry. Updates anchor.
export function toggleSelection(folderKey: string, filename: string): void {
  toggleId(entryId(folderKey, filename));
}

// Shift-click extends the anchor's action across a range. If there's no anchor yet
// (or the anchor isn't in `orderedEntries`), falls back to a regular toggle.
export function shiftToggleSelection(entry: SelectionEntry, orderedEntries: SelectionEntry[]): void {
  const id = entryId(entry.folderKey, entry.filename);
  if (!anchor) {
    toggleId(id);
    return;
  }
  const orderedIds = orderedEntries.map(e => entryId(e.folderKey, e.filename));
  const a = orderedIds.indexOf(anchor.id);
  const b = orderedIds.indexOf(id);
  if (a < 0 || b < 0) {
    toggleId(id);
    return;
  }
  const [from, to] = a <= b ? [a, b] : [b, a];
  const range = orderedIds.slice(from, to + 1);
  if (anchor.action === 'select') {
    range.forEach(i => selected.add(i));
  } else {
    range.forEach(i => selected.delete(i));
  }
  // Update anchor to the new endpoint, keeping the same action.
  anchor = { id, action: anchor.action };
  notify();
}

// Bulk add (used by "select all visible"). Does not change anchor.
export function selectEntries(entries: SelectionEntry[]): void {
  entries.forEach(e => selected.add(entryId(e.folderKey, e.filename)));
  notify();
}

export function clearSelection(): void {
  selected.clear();
  anchor = null;
  notify();
}
