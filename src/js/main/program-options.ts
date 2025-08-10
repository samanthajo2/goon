export type ProgOptions = {
  help: boolean;
  userDataDir: string;
  inspector: string;
  listCacheFiles: boolean;
  compareFoldersToCache: boolean;
  deleteFolderDataIfNoFilesForArchive: boolean;
  maxParallelReaddirs: number;
  readdirsThrottleDuration: number;
  _: string[];
};
