/*
  Preferences service. Runs in the main process and is the single owner of
  prefs.json: it loads them at startup, persists every change, and broadcasts
  the current values to every subscriber.

  This used to live in the prefs *window*, which made that window a service the
  rest of the app depended on -- it had to be created at startup and could only
  ever be hidden, never closed. On macOS a window belongs to the Space it was
  created in, so a long-lived hidden prefs window opened from a fullscreened
  view dragged the user back to the Space the app launched in and stranded an
  empty Space behind when it was hidden again. Owning prefs here lets the prefs
  window be an ordinary window: built on demand, destroyed on close.

  Subscribers reach this over the ordinary `prefs` channel
  (createChannelStream('prefs')), so view windows, the thumber and browser
  clients on the WebSocket bridge are all unchanged -- they cannot tell that
  main rather than a renderer is now answering.

  Protocol:
    in   requestPrefs            -> out prefs (effective: CLI folder override applied)
    in   requestPrefsForEditing  -> out prefs (raw, as persisted) and marks the
                                    peer as an editor so later broadcasts stay raw
    in   setPrefs <prefs>        replace wholesale; from the prefs editor
    in   setMiscPref <key> <val> patch one misc value; from any window
    out  prefs <prefs>           broadcast after any change
    out  saveError <bool>        broadcast to editors when a write fails
*/

import fs from 'node:fs';
import { createMainChannel, type Channel, type ChannelStream } from '../lib/window-ipc.js';
import { loadPrefs, type Preferences } from '../pages/prefs/default-prefs.js';
import { readUTF8FileSync, debounce, cloneDeep } from '../lib/utils.js';

export type PrefsService = {
  // As persisted. This is what the editor shows and what gets written to disk.
  getPrefs(): Preferences;
  // What subscribers see: folders replaced by the command-line list when one
  // was given, so `goon somedir` shows that directory without rewriting prefs.
  getEffectivePrefs(): Preferences;
  // Write any debounced edit out synchronously. For quit, which runs on a short
  // fuse -- main kills the process in will-quit -- so a scheduled write is lost.
  flush(): void;
  close(): void;
};

type Options = {
  prefsPath: string;
  // Positional folder arguments, if any (main's `args._`).
  folderOverride?: string[];
  // Main's own reaction to a prefs change (folder router, menus, web server).
  // Called with the effective prefs, matching what subscribers receive.
  onChange: (prefs: Preferences) => void;
  // Seam for tests, which drive the protocol through a fake channel rather
  // than standing up the Electron relay.
  createChannel?: (channelId: string) => Channel;
};

export function startPrefsService({ prefsPath, folderOverride, onChange, createChannel = createMainChannel }: Options): PrefsService {
  const { error, prefs: loaded } = loadPrefs(prefsPath, {
    existsSync: fs.existsSync,
    readUTF8FileSync,
  });

  let prefs: Preferences = loaded;
  // Editors see raw prefs; everyone else sees the effective ones. Tracked per
  // peer so a `goon somedir` override can't be saved back into prefs.json by
  // the editor round-tripping what it was shown.
  const editors = new Set<ChannelStream>();
  const streams = new Set<ChannelStream>();

  function effectivePrefs(): Preferences {
    if (!folderOverride || !folderOverride.length) {
      return prefs;
    }
    return Object.assign(cloneDeep(prefs), { folders: folderOverride });
  }

  // Set whenever prefs change, cleared once they reach disk, so a quit that
  // lands inside the debounce window can still flush them synchronously.
  let unsaved = false;

  function savePrefsImpl(): void {
    unsaved = false;
    try {
      fs.writeFile(prefsPath, JSON.stringify(prefs, null, 2), (err) => {
        if (err) {
          console.error('[prefs] could not save:', prefsPath, err);
          unsaved = true;
        }
        broadcastSaveError(!!err);
      });
    } catch (e) {
      console.error('[prefs] could not save:', prefsPath, e);
      unsaved = true;
      broadcastSaveError(true);
    }
  }
  const savePrefs = debounce(savePrefsImpl, 200);

  function broadcastSaveError(failed: boolean): void {
    for (const stream of editors) {
      stream.send('saveError', failed);
    }
  }

  function broadcast(skip?: ChannelStream): void {
    const effective = effectivePrefs();
    for (const stream of streams) {
      if (stream === skip) continue;
      stream.send('prefs', editors.has(stream) ? prefs : effective);
    }
    onChange(effective);
  }

  // `skip` is the peer whose own edit this is, used only for setPrefs: the
  // editor already has the value it just sent, and echoing it back races the
  // next keystroke. setMiscPref deliberately does NOT skip -- a view toggling
  // e.g. showEmpty relies on the broadcast coming back to update its own state.
  function update(newPrefs: Preferences, skip?: ChannelStream): void {
    prefs = newPrefs;
    unsaved = true;
    savePrefs();
    broadcast(skip);
  }

  const channel: Channel = createChannel('prefs');
  channel.on('connect', (stream: ChannelStream) => {
    streams.add(stream);
    stream.on('disconnect', () => {
      streams.delete(stream);
      editors.delete(stream);
    });
    // Pull-based: a peer asks only once its 'prefs' listener is attached, which
    // avoids the race where pushing on connect arrives before that wiring.
    stream.on('requestPrefs', () => {
      stream.send('prefs', effectivePrefs());
    });
    stream.on('requestPrefsForEditing', () => {
      editors.add(stream);
      stream.send('prefs', prefs);
    });
    stream.on('setPrefs', (newPrefs: Preferences) => {
      update(newPrefs, stream);
    });
    stream.on('setMiscPref', (key: string, value: unknown) => {
      update({ ...prefs, misc: { ...prefs.misc, [key]: value } } as Preferences);
    });
  });

  function flush(): void {
    savePrefs.cancel();
    if (!unsaved) return;
    try {
      fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
      unsaved = false;
    } catch (e) {
      console.error('[prefs] could not save:', prefsPath, e);
    }
  }

  // A prefs.json that failed to parse has been replaced by defaults in memory;
  // write those out so the bad file doesn't keep failing on every launch.
  if (error) {
    unsaved = true;
    savePrefs();
  }

  return {
    getPrefs: () => prefs,
    getEffectivePrefs: effectivePrefs,
    flush,
    close: () => {
      flush();
      channel.close();
    },
  };
}
