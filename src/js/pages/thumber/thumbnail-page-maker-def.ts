
import { FilesByPath } from '../../lib/fileinfo';

export type MakeThumbnailPagesFn = (
  baseFilename: string,
  oldFiles: FilesByPath,
  newFiles: FilesByPath,
) => Promise<FilesByPath>;
