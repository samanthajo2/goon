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

// The video seek ("cue") slider, shared by the viewer toolbar and the in-viewer
// player. It's a 0..10000 range over the current time, with loop start/end markers
// overlaid, and it dispatches a TimeUpdateEvent (in seconds) on scrub. `className`
// carries the caller's layout class (e.g. "cue" or "que").

import React from 'react';
import LoopMarkers from './loop-markers.js';
import { TimeUpdateEvent, VideoState } from './viewer-events.js';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher.js';
import type { AppEventMap } from './app-event-map.js';

type Props = {
  videoState: VideoState;
  eventBus: ForwardableEventDispatcher<AppEventMap>;
  className?: string;
};

export default function CueSlider({ videoState, eventBus, className }: Props): React.ReactElement {
  const onChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    eventBus.dispatch(
      new TimeUpdateEvent(Number(event.target.value) / Number(event.target.max) * videoState.duration),
    );
  };
  return (
    <div className={`cue-slider${className ? ` ${className}` : ''}`}>
      <input
        type="range"
        min={0}
        max={10000}
        value={videoState.time / videoState.duration * 10000}
        onChange={onChange}
      />
      <LoopMarkers videoState={videoState} />
    </div>
  );
}
