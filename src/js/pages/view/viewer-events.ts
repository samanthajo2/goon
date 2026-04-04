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

import ForwardableEvent from '../../lib/forwardable-event';

// MobX observable shape created in viewer.jsx / viewer.tsx
export type VideoState = {
  time: number;
  duration: number;
  volume: number;
  playing: boolean;
  playbackRate: number;
  currentUrl: string;
  loop: number;      // 0 = off, 1 = start set, 2 = range set
  loopStart: number;
  loopEnd: number;
};

// Shape passed to FileContextMenu and FolderContextMenu
export type FolderContextInfo = {
  filename: string;
  archive?: boolean;
};

// MobX observable state passed from viewer to toolbars
export type ViewerState = {
  zoom: number;
  mimeType: string;
  viewing: boolean;
  filename?: string;
  videoState: VideoState;
};

export type ViewerStateHolder = {
  state: ViewerState | null;
};

export type ImagegridStateHolder = {
  state: {
    zoom: number;
    currentCollection: unknown;
  } | null;
};

export class TimeUpdateEvent extends ForwardableEvent {
  time: number;
  duration: number;

  constructor(time: number, duration?: number) {
    super('timeupdate');
    this.time = time;
    this.duration = duration ?? 0;
  }
}
