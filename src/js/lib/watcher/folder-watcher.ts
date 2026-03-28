import EventEmitter from 'node:events';

export type FolderWatcherInterface = EventEmitter & {
  folderName: string;
  close: () => void;
};
