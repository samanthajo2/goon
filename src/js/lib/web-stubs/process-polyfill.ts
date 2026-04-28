/*
  Tiny `process` polyfill injected at the top of the browser bundle so any
  shared code that does `process.env.X` / `process.nextTick(...)` /
  `process.platform` keeps working without the renderer-side conditional
  every place. Only the bits that actually get used here are filled in.
*/

// Cast through unknown — Node's @types/node types `process` as a complex
// `Process` object, but at the browser bundle level we only need the few
// fields the bundled renderer code actually reads. The stub stays minimal.
const g = globalThis as unknown as { process?: unknown };
if (typeof g.process === 'undefined') {
  g.process = {
    env: {},
    platform: 'web',
    type: 'renderer',
    nextTick: (cb: () => void) => { queueMicrotask(cb); },
  };
}

export {};
