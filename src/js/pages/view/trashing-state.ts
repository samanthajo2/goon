// Plain set + lightweight pub/sub so individual overlay components can subscribe
// without per-thumbnail subscriptions.
export const trashingFiles = new Set<string>();

const listeners = new Set<() => void>();

export function addTrashingFile(filename: string): void {
  trashingFiles.add(filename);
  listeners.forEach(fn => fn());
}

export function removeTrashingFile(filename: string): void {
  trashingFiles.delete(filename);
  listeners.forEach(fn => fn());
}

export function subscribeTrashingFiles(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
