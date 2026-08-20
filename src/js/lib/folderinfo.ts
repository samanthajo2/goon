import { FilesByPath } from './fileinfo.js';

export type FolderStatus = {
  checking: boolean;
  scanning: boolean;
  scannedTime: number;
  virtual?: boolean;  // set for user-curated virtual folders
  name?: string;      // display name (virtual folders; real folders use their path)
};

export type FolderInfo = {
  files: FilesByPath;
  status: FolderStatus;
};

export type FoldersByPath = { [key: string]: FolderInfo };
