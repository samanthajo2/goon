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

// Records the app to a webm: the whole window as video (via getDisplayMedia, which
// the main process auto-points at our own window), plus a live mix of every playing
// media element's audio (<video> *and* <audio>).
//
// The two tracks handed to MediaRecorder never change for the life of the recording:
//   • video is a single window-capture track — splits/new panes/deletions are just
//     pixels, so layout changes are captured for free; and
//   • audio is a single MediaStreamAudioDestinationNode track — we add/remove each
//     element's audio *into that graph* (a MutationObserver watches the DOM), but the
//     output track is stable, so MediaRecorder never sees a track come or go.
//
// Each element's audio passes through its own GainNode. captureStream() taps a media
// element *before* its volume control, so a video turned down or muted in the UI
// still arrives here at full level — the gain is what actually applies the user's
// volume to the recording. Gains are normalized so the loudest element sits at unity:
// three videos playing at 30% should record at full level, not at 30%.
//
// This graph only feeds the recording. The elements keep playing to the speakers
// through their normal path, so none of this changes what the user hears.

import debug from '../../lib/debug.js';

const logger = debug('ScreenRecorder');

type RecState = {
  recorder: MediaRecorder;
  chunks: Blob[];
  ctx: AudioContext;
  mixDest: MediaStreamAudioDestinationNode;
  observer: MutationObserver;
  silence: ConstantSourceNode;
  displayStream: MediaStream;
  sources: Map<HTMLMediaElement, HookedSource>;
};

type HookedSource = {
  node: MediaStreamAudioSourceNode;
  gain: GainNode;
  // Kept so it can be removed when the element goes away.
  onVolumeChange: () => void;
};

// captureStream() isn't in the default DOM lib types.
type CapturableMedia = HTMLMediaElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

let g_state: RecState | null = null;

export function isRecording(): boolean {
  return g_state !== null;
}

// What the user actually hears from an element: muted beats the slider.
export function effectiveVolume(el: HTMLMediaElement): number {
  return el.muted ? 0 : el.volume;
}

/**
 * Scale a set of element volumes so the loudest becomes 1, preserving their
 * relative balance. All-silent stays all-silent rather than dividing by zero.
 */
export function computeMixGains(volumes: number[]): number[] {
  const max = volumes.reduce((a, v) => Math.max(a, v), 0);
  return volumes.map(v => (max > 0 ? v / max : 0));
}

// Every playing media element contributes audio — both <video> and <audio>.
function collectMedia(node: Node): HTMLMediaElement[] {
  if (node instanceof HTMLMediaElement) return [node];
  if (node instanceof Element) return [...node.querySelectorAll<HTMLMediaElement>('video, audio')];
  return [];
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'video/webm';
}

export async function startRecording(root: HTMLElement): Promise<void> {
  if (g_state) return;

  // Live audio mix of every <video> under root.
  //
  // Built BEFORE the getDisplayMedia await, so the AudioContext is created in the
  // turn of the user gesture that started the recording. Created after the await,
  // Chromium can bring it up suspended -- a suspended context renders nothing, so
  // the mix track delivers no samples and MediaRecorder writes a zero-byte file.
  // That only showed with nothing playing: an active <video> makes Chromium start
  // the context running anyway, which is why recording a grid worked if a video
  // had been open when the recording started.
  const ctx = new AudioContext();
  const mixDest = ctx.createMediaStreamDestination();

  // A destination with nothing connected delivers no samples, even with the
  // context running -- MediaRecorder then waits forever for audio that never
  // arrives and writes an empty file. That only bit when recording started with
  // nothing playing; once anything has fed the destination it keeps delivering,
  // which is why starting with a video and then closing it kept working.
  // So hold one silent input connected for the life of the recording.
  const silence = ctx.createConstantSource();
  silence.offset.value = 0;
  silence.connect(mixDest);
  silence.start();

  // Whole-window video. The main process's display-media handler auto-selects our
  // own window, so there's no picker.
  let displayStream: MediaStream;
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (e) {
    // The context exists before this point now, so it has to be cleaned up on
    // every path out or it leaks an audio device.
    silence.stop();
    void ctx.close();
    throw e;
  }
  const videoTrack = displayStream.getVideoTracks()[0];
  if (!videoTrack) {
    displayStream.getTracks().forEach(t => t.stop());
    silence.stop();
    void ctx.close();
    throw new Error('getDisplayMedia returned no video track');
  }

  // Belt and braces: if it came up suspended anyway, a resume is allowed here
  // because the document has sticky activation from the gesture.
  if (ctx.state === 'suspended') {
    await ctx.resume().catch((e) => { logger('could not resume audio context', e); });
  }
  logger('audio context state:', ctx.state);
  const sources = new Map<HTMLMediaElement, HookedSource>();

  // Any change to any element rescales every gain, since the loudest element
  // defines the ceiling. Ramp rather than jump: a step change in gain clicks.
  const recomputeGains = (): void => {
    const els = [...sources.keys()];
    const gains = computeMixGains(els.map(effectiveVolume));
    els.forEach((el, i) => {
      sources.get(el)?.gain.gain.setTargetAtTime(gains[i], ctx.currentTime, 0.015);
    });
  };

  const hook = (el: HTMLMediaElement): void => {
    if (sources.has(el)) return;
    const m = el as CapturableMedia;
    const capture = m.captureStream ?? m.mozCaptureStream;
    if (!capture) return;
    try {
      const audioTracks = capture.call(m).getAudioTracks();
      if (audioTracks.length === 0) return;
      const node = ctx.createMediaStreamSource(new MediaStream(audioTracks));
      const gain = ctx.createGain();
      // Starts silent so recomputeGains fades it in instead of popping.
      gain.gain.value = 0;
      node.connect(gain);
      gain.connect(mixDest);
      const onVolumeChange = (): void => { recomputeGains(); };
      // Fires for both volume and muted changes.
      el.addEventListener('volumechange', onVolumeChange);
      sources.set(el, { node, gain, onVolumeChange });
      recomputeGains();
    } catch (e) {
      logger('could not hook audio for a media element', e);
    }
  };
  const unhook = (el: HTMLMediaElement): void => {
    const hooked = sources.get(el);
    if (hooked) {
      el.removeEventListener('volumechange', hooked.onVolumeChange);
      hooked.node.disconnect();
      hooked.gain.disconnect();
      sources.delete(el);
      recomputeGains();
    }
  };

  collectMedia(root).forEach(hook);
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach(n => collectMedia(n).forEach(hook));
      m.removedNodes.forEach(n => collectMedia(n).forEach(unhook));
    }
  });
  observer.observe(root, { childList: true, subtree: true });

  const stream = new MediaStream([videoTrack, ...mixDest.stream.getAudioTracks()]);
  const recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  // A recorder error is why a recording silently comes out empty; never swallow it.
  recorder.onerror = (e: Event) => {
    console.error('[rec] MediaRecorder error', (e as unknown as { error?: unknown }).error ?? e);
  };
  // If the OS/user stops the window capture, end the recording cleanly.
  videoTrack.addEventListener('ended', () => { if (g_state) void stopRecording(); });
  recorder.start(1000); // flush a chunk every second

  g_state = { recorder, chunks, ctx, mixDest, observer, displayStream, sources, silence };
  logger('recording started', recorder.mimeType, 'ctx', ctx.state, 'sources', sources.size);
}

// Stops recording and returns the finished webm blob.
export async function stopRecording(): Promise<Blob> {
  const s = g_state;
  if (!s) throw new Error('not recording');
  g_state = null;
  s.observer.disconnect();

  const blob = await new Promise<Blob>((resolve) => {
    s.recorder.addEventListener('stop', () => {
      resolve(new Blob(s.chunks, { type: s.recorder.mimeType || 'video/webm' }));
    }, { once: true });
    s.recorder.stop();
  });

  s.displayStream.getTracks().forEach(t => t.stop());
  s.silence.stop();
  s.silence.disconnect();
  for (const [el, hooked] of s.sources) {
    el.removeEventListener('volumechange', hooked.onVolumeChange);
    hooked.node.disconnect();
    hooked.gain.disconnect();
  }
  try { await s.ctx.close(); } catch { /* already closed */ }
  logger('recording stopped', blob.size, 'bytes');
  // Saving a zero-byte file is worse than failing: it looks like it worked.
  if (blob.size === 0) {
    throw new Error('the recorder produced no data');
  }
  return blob;
}
