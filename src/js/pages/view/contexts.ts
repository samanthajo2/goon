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

import { createContext } from 'react';
import type ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher';
import type { AppEventMap } from './app-event-map';
import type { Preferences } from '../prefs/default-prefs';

export type AppContextValue = {
  // The event bus for the current subtree. app.tsx provides the root bus;
  // VPair re-provides this context with its own local bus so that its children
  // (ImageGrids, Viewer, Thumbnail, Player) automatically route events through
  // the correct pane without each needing an eventBus prop.
  eventBus: ForwardableEventDispatcher<AppEventMap>;

  // Application preferences — provided once at the app level and updated
  // whenever the prefs IPC stream emits a new value.
  prefs: Preferences;
};

// The default value is never used at runtime because AppContext.Provider is
// always present above every consumer. `null as unknown as` avoids the need
// to supply a fake default that satisfies the full type.
export const AppContext = createContext<AppContextValue>(null as unknown as AppContextValue);
