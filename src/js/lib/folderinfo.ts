import { FilesByPath } from "./fileinfo";

export type FolderStatus = {
  checking: boolean;
  scanning: boolean;
  scannedTime: number;
};

export type FolderInfo = {
  files: FilesByPath;
  status: FolderStatus;
};

export type FoldersByPath = { [key: string]: FolderInfo };
