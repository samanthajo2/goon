/*
  Web entry point for the view page. Boots the same <App /> that runs in
  Electron, but with the web Platform impl so all backend traffic flows
  over WebSocket and asset URLs are served by the express folder router.

  Loaded by `app/external.html` which is served at `/` when the optional
  web server is enabled (prefs.misc.enableWeb).
*/

import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './app.js';
import { createWebPlatform, loadStartState } from '../../lib/web-platform.js';
import '../../lib/stacktrace-log.js';
import '../../lib/title.js';

console.log('page: external-view');

async function main(): Promise<void> {
  const platform = await createWebPlatform();
  const startState = loadStartState();
  const options = {
    columnWidth: 160,
    padding: 10,
    maxSeekTime: 30,
    currentVPairNdx: 0,
  };
  createRoot(document.querySelector('.browser')!).render(
    <App options={options} startState={startState as never} platform={platform} />,
  );
}

main().catch((err: unknown) => {
  console.error('boot failed:', err);
  document.body.innerHTML = `<pre style="color:#f55;padding:1em">${String(err)}</pre>`;
});
