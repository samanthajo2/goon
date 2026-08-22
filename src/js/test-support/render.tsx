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

// Render helper for component tests: mounts a component inside a real AppContext with
// lightweight fakes (platform, prefs, event bus), so tests can assert on rendered
// output and interactions. Requires a DOM — tests run under `--import
// ./test/register-dom.js` (happy-dom).

import React from 'react';
import { render, RenderResult } from '@testing-library/react';
import ForwardableEventDispatcher from '../lib/forwardable-event-dispatcher.js';
import { AppContext, AppContextValue } from '../pages/view/contexts.js';
import type { Platform } from '../lib/platform.js';
import type { Preferences } from '../pages/prefs/default-prefs.js';
import type { AppEventMap } from '../pages/view/app-event-map.js';

export type RenderOptions = {
  platform?: Partial<Platform>;
  prefs?: Partial<Preferences>;
  eventBus?: ForwardableEventDispatcher<AppEventMap>;
};

// Minimal platform: fileToUrl is identity-ish; capability flags default on so
// capability-gated UI renders. Override per test as needed.
function makePlatform(overrides?: Partial<Platform>): Platform {
  return {
    fileToUrl: (p: string) => p,
    deleteFile: async () => {},
    deleteFolder: async () => {},
    showItemInFolder: () => {},
    openPath: () => {},
    ...overrides,
  } as unknown as Platform;
}

export type Rendered = RenderResult & {
  eventBus: ForwardableEventDispatcher<AppEventMap>;
};

export function renderWithContext(ui: React.ReactElement, options: RenderOptions = {}): Rendered {
  const eventBus = options.eventBus ?? new ForwardableEventDispatcher<AppEventMap>();
  const value: AppContextValue = {
    eventBus,
    platform: makePlatform(options.platform),
    prefs: (options.prefs ?? {}) as Preferences,
  };
  const result = render(<AppContext value={value}>{ui}</AppContext>);
  return Object.assign(result, { eventBus });
}
