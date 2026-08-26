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

import EventEmitter from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, after } from '../lib/test/mocha.js';
import { assert } from 'chai';
import { startPrefsService, type PrefsService } from './prefs-service.js';
import type { Channel, ChannelStream } from '../lib/window-ipc.js';
import type { Preferences } from '../pages/prefs/default-prefs.js';
import wait from '../lib/wait.js';

// Longer than the service's 200ms save debounce.
const AFTER_DEBOUNCE = 300;

type Sent = { event: string; args: unknown[] };

// Stands in for a peer (a view window, the thumber, or the prefs editor).
// Incoming service→peer messages are recorded; outgoing peer→service messages
// are emitted, which is exactly what the real relay does on the main side.
class FakeStream extends EventEmitter implements ChannelStream {
  readonly sent: Sent[] = [];
  send(event: string, ...args: unknown[]): void {
    this.sent.push({ event, args });
  }
  close(): void {
    this.emit('disconnect');
  }
  lastPrefs(): Preferences | undefined {
    const prefsMsgs = this.sent.filter((m) => m.event === 'prefs');
    return prefsMsgs.length ? prefsMsgs[prefsMsgs.length - 1].args[0] as Preferences : undefined;
  }
  countOf(event: string): number {
    return this.sent.filter((m) => m.event === event).length;
  }
}

function makeFakeChannel(): { channel: Channel; connect: (s: ChannelStream) => void } {
  const emitter = new EventEmitter();
  const channel: Channel = {
    on: (event: string, listener: (...args: unknown[]) => void) => { emitter.on(event, listener); return channel; },
    close: () => { emitter.removeAllListeners(); },
  };
  return { channel, connect: (s: ChannelStream) => { emitter.emit('connect', s); } };
}

const tempDirs: string[] = [];

function makeTempPrefsPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goon-prefs-test-'));
  tempDirs.push(dir);
  return path.join(dir, 'prefs.json');
}

const started: PrefsService[] = [];

after(() => {
  // Close first: a test that changed prefs without waiting still has a 200ms
  // save scheduled, and it would fire into a deleted directory.
  for (const service of started) {
    service.close();
  }
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

type Harness = {
  service: ReturnType<typeof startPrefsService>;
  connect: (s: ChannelStream) => void;
  changes: Preferences[];
  prefsPath: string;
};

function start(folderOverride?: string[]): Harness {
  const prefsPath = makeTempPrefsPath();
  const { channel, connect } = makeFakeChannel();
  const changes: Preferences[] = [];
  const service = startPrefsService({
    prefsPath,
    folderOverride,
    onChange: (p) => { changes.push(p); },
    createChannel: () => channel,
  });
  started.push(service);
  return { service, connect, changes, prefsPath };
}

describe('prefs-service', () => {
  describe('handing prefs out', () => {
    it('answers requestPrefs with the effective prefs', () => {
      const h = start();
      const view = new FakeStream();
      h.connect(view);
      view.emit('requestPrefs');
      assert.deepEqual(view.lastPrefs()?.folders, h.service.getPrefs().folders);
    });

    it('applies the command-line folder override for subscribers', () => {
      const h = start(['/cli/folder']);
      const view = new FakeStream();
      h.connect(view);
      view.emit('requestPrefs');
      assert.deepEqual(view.lastPrefs()?.folders, ['/cli/folder']);
    });

    it('gives the editor the raw prefs, not the folder override', () => {
      const h = start(['/cli/folder']);
      const editor = new FakeStream();
      h.connect(editor);
      editor.emit('requestPrefsForEditing');
      // The editor must never see the override: it round-trips what it is shown
      // back via setPrefs, which would write the CLI folders into prefs.json.
      assert.notDeepEqual(editor.lastPrefs()?.folders, ['/cli/folder']);
      assert.deepEqual(editor.lastPrefs()?.folders, h.service.getPrefs().folders);
    });

    it('sends nothing until asked', () => {
      const h = start();
      const view = new FakeStream();
      h.connect(view);
      assert.equal(view.countOf('prefs'), 0);
    });
  });

  describe('setPrefs from the editor', () => {
    it('persists to disk', async () => {
      const h = start();
      const editor = new FakeStream();
      h.connect(editor);
      editor.emit('requestPrefsForEditing');
      const next = { ...h.service.getPrefs(), folders: ['/added'] } as Preferences;
      editor.emit('setPrefs', next);
      await wait(AFTER_DEBOUNCE);
      const written = JSON.parse(fs.readFileSync(h.prefsPath, 'utf8'));
      assert.deepEqual(written.folders, ['/added']);
    });

    it('broadcasts to other subscribers', () => {
      const h = start();
      const view = new FakeStream();
      const editor = new FakeStream();
      h.connect(view);
      h.connect(editor);
      view.emit('requestPrefs');
      editor.emit('requestPrefsForEditing');
      editor.emit('setPrefs', { ...h.service.getPrefs(), folders: ['/added'] } as Preferences);
      assert.deepEqual(view.lastPrefs()?.folders, ['/added']);
    });

    it('does not echo back to the editor that sent it', () => {
      const h = start();
      const editor = new FakeStream();
      h.connect(editor);
      editor.emit('requestPrefsForEditing');
      const before = editor.countOf('prefs');
      editor.emit('setPrefs', { ...h.service.getPrefs(), folders: ['/added'] } as Preferences);
      // An echo would race the next keystroke in the editor.
      assert.equal(editor.countOf('prefs'), before);
    });

    it('notifies main', () => {
      const h = start();
      const editor = new FakeStream();
      h.connect(editor);
      editor.emit('setPrefs', { ...h.service.getPrefs(), folders: ['/added'] } as Preferences);
      assert.deepEqual(h.changes.at(-1)?.folders, ['/added']);
    });
  });

  describe('setMiscPref from any window', () => {
    it('patches one value and leaves the rest alone', () => {
      const h = start();
      const view = new FakeStream();
      h.connect(view);
      const before = h.service.getPrefs();
      view.emit('setMiscPref', 'showEmpty', true);
      assert.equal(h.service.getPrefs().misc.showEmpty, true);
      assert.deepEqual(h.service.getPrefs().folders, before.folders);
    });

    it('does echo back to the window that sent it', () => {
      const h = start();
      const view = new FakeStream();
      h.connect(view);
      view.emit('requestPrefs');
      const before = view.countOf('prefs');
      view.emit('setMiscPref', 'showEmpty', true);
      // The view's own toggle state comes back through this broadcast, so
      // unlike setPrefs it must NOT skip the sender.
      assert.equal(view.countOf('prefs'), before + 1);
    });
  });

  describe('disconnect', () => {
    it('stops broadcasting to a peer that went away', () => {
      const h = start();
      const gone = new FakeStream();
      const view = new FakeStream();
      h.connect(gone);
      h.connect(view);
      gone.close();
      const before = gone.countOf('prefs');
      view.emit('setMiscPref', 'showEmpty', true);
      assert.equal(gone.countOf('prefs'), before);
      assert.isAbove(view.countOf('prefs'), 0);
    });
  });

  describe('flush', () => {
    it('writes a pending edit synchronously', () => {
      const h = start();
      const editor = new FakeStream();
      h.connect(editor);
      editor.emit('setPrefs', { ...h.service.getPrefs(), folders: ['/added'] } as Preferences);
      // Still inside the debounce window — nothing on disk yet.
      assert.isFalse(fs.existsSync(h.prefsPath));
      h.service.flush();
      const written = JSON.parse(fs.readFileSync(h.prefsPath, 'utf8'));
      assert.deepEqual(written.folders, ['/added']);
    });
  });
});
