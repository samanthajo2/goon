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

import debug from '../../lib/debug.js';

const logger = debug('ScreenRecorder');

type RecState = {
  recorder: MediaRecorder;
  chunks: Blob[];
  ctx: AudioContext;
  mixDest: MediaStreamAudioDestinationNode;
  observer: MutationObserver;
  displayStream: MediaStream;
  sources: Map<HTMLMediaElement, MediaStreamAudioSourceNode>;
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

  // Whole-window video. The main process's display-media handler auto-selects our
  // own window, so there's no picker.
  const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const videoTrack = displayStream.getVideoTracks()[0];
  if (!videoTrack) {
    displayStream.getTracks().forEach(t => t.stop());
    throw new Error('getDisplayMedia returned no video track');
  }

  // Live audio mix of every <video> under root.
  const ctx = new AudioContext();
  const mixDest = ctx.createMediaStreamDestination();
  const sources = new Map<HTMLMediaElement, MediaStreamAudioSourceNode>();

  const hook = (el: HTMLMediaElement): void => {
    if (sources.has(el)) return;
    const m = el as CapturableMedia;
    const capture = m.captureStream ?? m.mozCaptureStream;
    if (!capture) return;
    try {
      const audioTracks = capture.call(m).getAudioTracks();
      if (audioTracks.length === 0) return;
      const node = ctx.createMediaStreamSource(new MediaStream(audioTracks));
      node.connect(mixDest);
      sources.set(el, node);
    } catch (e) {
      logger('could not hook audio for a media element', e);
    }
  };
  const unhook = (el: HTMLMediaElement): void => {
    const node = sources.get(el);
    if (node) {
      node.disconnect();
      sources.delete(el);
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
  // If the OS/user stops the window capture, end the recording cleanly.
  videoTrack.addEventListener('ended', () => { if (g_state) void stopRecording(); });
  recorder.start(1000); // flush a chunk every second

  g_state = { recorder, chunks, ctx, mixDest, observer, displayStream, sources };
  logger('recording started', recorder.mimeType);
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
  for (const node of s.sources.values()) node.disconnect();
  try { await s.ctx.close(); } catch { /* already closed */ }
  logger('recording stopped', blob.size, 'bytes');
  return blob;
}
