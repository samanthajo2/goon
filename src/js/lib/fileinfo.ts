import { Rect } from './rect.js';

export type ThumbnailInfo = Rect & {
  url: string;
  pageSize: number;
};

export type FileInfo = {
  displayName: string;
  url?: string;  // only set for archives?
  archiveName?: string; // only set for archives?
  archiveMtime?: number; // mtime of the containing archive file when thumbnailed
                         // (virtual folders use it to detect a changed archive)
  isDirectory: boolean;
  mtime: number;
  orientation: number;
  size: number;
  type: string;  // mime-type
  width: number;
  height: number;
  thumbnail: ThumbnailInfo;
  bad?: boolean;
};

export type FilesByPath = { [key: string]: FileInfo };
