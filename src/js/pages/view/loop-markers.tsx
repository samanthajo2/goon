/*
Copyright 2026 SamanthaJo

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

// Loop start/end markers drawn over a cue (seek) slider. Renders nothing when there
// is no loop, one marker once the start is set (loop === 1), and two once the range
// is set (loop === 2). Positioned by time fraction; the parent must be
// position:relative and size-matched to the slider track.

import React from 'react';
import type { VideoState } from './viewer-events.js';

export default function LoopMarkers({ videoState }: { videoState: VideoState }): React.ReactElement | null {
  const { loop, loopStart, loopEnd, duration } = videoState;
  if (!loop || !duration) {
    return null;
  }
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / duration) * 100))}%`;
  return (
    <>
      <div className="loop-marker" style={{ left: pct(loopStart) }} />
      {loop === 2 && <div className="loop-marker" style={{ left: pct(loopEnd) }} />}
    </>
  );
}
