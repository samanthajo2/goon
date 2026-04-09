
import { FilesByPath } from '../../lib/fileinfo.js';

export type MakeThumbnailPagesFn = (
  baseFilename: string,
  oldFiles: FilesByPath,
  newFiles: FilesByPath,
) => Promise<FilesByPath>;
