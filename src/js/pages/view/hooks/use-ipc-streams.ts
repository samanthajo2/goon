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

const RETRY_DELAY_MS = 2000;

type Callbacks = {
  onTrashFailed: (filename: string) => void;
};

export function useIPCStreams(platform: Platform, callbacks: Callbacks): {
  thumberStream: ChannelStream | null;
  prefs: Partial<Preferences>;
  prefsReceived: boolean;
  disconnected: boolean;
} {
  // Keep callbacks stable via ref — callers don't need to memoize them
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const [thumberStream, setThumberStream] = useState<ChannelStream | null>(null);
  const [prefs, setPrefs] = useState<Partial<Preferences>>({});
  const [prefsReceived, setPrefsReceived] = useState(false);
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let thumberStreamLocal: ChannelStream | null = null;
    let prefsStreamLocal: ChannelStream | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const handleDisconnect = (): void => {
      if (cancelled) return;
      setDisconnected(true);
      // Drop the streams; they're closed.
      thumberStreamLocal = null;
      prefsStreamLocal = null;
      setThumberStream(null);
      retryTimer = setTimeout(() => { connect(); }, RETRY_DELAY_MS); // eslint-disable-line @typescript-eslint/no-use-before-define
    };

    const connect = async (): Promise<void> => {
      if (cancelled) return;
      retryTimer = null;
      try {
        const [tStream, pStream] = await Promise.all([
          platform.createChannelStream('thumber'),
          platform.createChannelStream('prefs'),
        ]);
        if (cancelled) {
          tStream.close();
          pStream.close();
          return;
        }
        thumberStreamLocal = tStream;
        prefsStreamLocal = pStream;
        tStream.on('trashFailed', (filename: string) => callbacksRef.current.onTrashFailed(filename));
        tStream.on('disconnect', handleDisconnect);
        pStream.on('prefs', (newPrefs: Preferences) => {
          setPrefs(newPrefs);
          setPrefsReceived(true);
        });
        pStream.on('disconnect', handleDisconnect);
        // Pull-based handshake — see prefs.tsx _addStream. Attaching the
        // listener and then requesting closes the race where push-on-
        // connect could arrive before the listener was wired up.
        pStream.send('requestPrefs');
        setThumberStream(tStream);
        setDisconnected(false);
      } catch (err) {
        console.error(err);
        if (cancelled) return;
        setDisconnected(true);
        retryTimer = setTimeout(() => { connect(); }, RETRY_DELAY_MS);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      thumberStreamLocal?.close();
      prefsStreamLocal?.close();
    };
  }, [platform]);

  return { thumberStream, prefs, prefsReceived, disconnected };
}
