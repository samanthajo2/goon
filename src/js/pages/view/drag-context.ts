// Source context for an in-app drag. Because a drag that leaves the window and
// comes back is an OS-native (Electron startDrag) drag, the re-entry drop only
// carries file paths (and even those are stripped in modern Electron) — not which
// folder the items came from. Both dragstart and drop happen in this one renderer,
// so we stash the dragged entries here at dragstart and read them on drop,
// "translating" the OS drop back into an internal drop.
//
// A multi-selection can span folders (and folder kinds), so we carry the full set
// of (folderKey, filename) entries; each item's source kind is resolved at drop.

export type DragEntry = { folderKey: string; filename: string };

export type DragContext = {
  entries: DragEntry[];
};

let current: DragContext | null = null;

export function setDragContext(ctx: DragContext | null): void {
  current = ctx;
}

export function getDragContext(): DragContext | null {
  return current;
}
