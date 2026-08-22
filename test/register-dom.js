// Registers a happy-dom DOM as globals so component tests can render React into a
// real document. Loaded via mocha `--import` before any test module (so `document`
// exists before React/Testing-Library load). Uses happy-dom's GlobalWindow directly —
// no extra registrator package.

import { GlobalWindow } from 'happy-dom';

const window = new GlobalWindow();

// Copy the window's own globals (document, HTMLElement, Event, getComputedStyle, …)
// onto globalThis, without clobbering anything Node already provides.
for (const key of Object.getOwnPropertyNames(window)) {
  if (key in globalThis) continue;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(window, key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  } catch {
    // Some entries are throwing getters; skip them.
  }
}

globalThis.window = window;
globalThis.document = window.document;
