const FileChangeType = {
  UPDATED: 1,
  ADDED: 2,
  DELETED: 3,
} as const;

export type FileChangeTypeValue = typeof FileChangeType[keyof typeof FileChangeType];

export type RawFileChange = {
  type: FileChangeTypeValue;
  path: string;
};

export default FileChangeType;
