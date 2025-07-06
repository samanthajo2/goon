import { Rect } from './rect';

export type ThumbnailInfo = Rect & {
  url: string;
  pageSize: number;
};

export type FileInfo = {
  displayName: string;
  url?: string;  // only set for archives?
  archiveName?: string; // only set for archives?
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
