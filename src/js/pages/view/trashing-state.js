// Plain set + lightweight pub/sub so individual overlay components can subscribe
// without making Thumbnail itself an MobX observer.
export const trashingFiles = new Set();

const listeners = new Set();

export function addTrashingFile(filename) {
  trashingFiles.add(filename);
  listeners.forEach(fn => fn());
}

export function removeTrashingFile(filename) {
  trashingFiles.delete(filename);
  listeners.forEach(fn => fn());
}

export function subscribeTrashingFiles(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
