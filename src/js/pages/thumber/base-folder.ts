/*
Copyright 2024 SamanthaJo

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import EventEmitter from 'node:events';
import { FilesByPath } from '../../lib/fileinfo';

export type SeparateFilenames = {
  imagesAndVideos: string[];
  folders: string[];
  archives: string[];
};

export type FolderStatus = {
  scanning: boolean;
  checking?: boolean;
  scannedTime?: number;
  archive?: boolean;
};

export type FolderDataResult = {
  files: FilesByPath;
  status: FolderStatus;
};

// Common interface implemented by NativeFolder and ArchiveFolder (and in future,
// CollectionFolder). A base class is not used because both classes rely on truly
// private (#) fields with different dependency shapes, leaving no shared
// implementation to place in a superclass.
export interface BaseFolder extends EventEmitter {
  readonly filename: string;
  getData(): FolderDataResult;
  deleteData(): SeparateFilenames;
  close(): void;
  getSeparateFilenames(): SeparateFilenames;
  refresh(): void;
}
