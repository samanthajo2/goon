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

import { useState, useEffect, useRef } from 'react';
import { type ChannelStream } from '../../../lib/window-ipc.js';
import type { Platform } from '../../../lib/platform.js';
import { Preferences } from '../../prefs/default-prefs.js';

function reload(): void {
  console.log('queue reload');
  setTimeout(() => {
    window.location.reload();
  }, 1000);
}

type Callbacks = {
  onTrashFailed: (filename: string) => void;
};

export function useIPCStreams(platform: Platform, callbacks: Callbacks): {
  thumberStream: ChannelStream | null;
  prefs: Partial<Preferences>;
  prefsReceived: boolean;
} {
  // Keep callbacks stable via ref — callers don't need to memoize them
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const [thumberStream, setThumberStream] = useState<ChannelStream | null>(null);
  const [prefs, setPrefs] = useState<Partial<Preferences>>({});
  const [prefsReceived, setPrefsReceived] = useState(false);

  useEffect(() => {
    let thumberStreamLocal: ChannelStream | null = null;
    let prefsStreamLocal: ChannelStream | null = null;

    platform.createChannelStream('thumber')
      .then((stream: ChannelStream) => {
        thumberStreamLocal = stream;
        setThumberStream(stream);
        stream.on('trashFailed', (filename: string) => callbacksRef.current.onTrashFailed(filename));
        stream.on('disconnect', reload);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (err instanceof Error && err.stack) console.error(err.stack);
      });

    platform.createChannelStream('prefs')
      .then((stream: ChannelStream) => {
        prefsStreamLocal = stream;
        stream.on('prefs', (newPrefs: Preferences) => {
          setPrefs(newPrefs);
          setPrefsReceived(true);
        });
        stream.on('disconnect', reload);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (err instanceof Error && err.stack) console.error(err.stack);
      });

    return () => {
      thumberStreamLocal?.close();
      prefsStreamLocal?.close();
    };
  }, [platform]);

  return { thumberStream, prefs, prefsReceived };
}
