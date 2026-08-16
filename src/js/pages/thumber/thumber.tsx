/*
Copyright 2024 SamanthaJo

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import { ipcRenderer } from '../../lib/electron-imports.js';
import { otherWindowIPC, type ChannelStream } from '../../lib/electron-renderer-imports.js';
import * as win from '../../lib/window-commands.js';
import fs from 'graceful-fs';
import path from 'path';
import { debounce } from '../../lib/utils.js';

import createLimitedResourceManager, { LimitedResourceManager } from '../../lib/limited-resource-manager.js';
import createMediaLoader from './media-loader.js';
import createThumbnailMaker from './thumbnail-maker.js';
import createThumbnailPageMaker from './thumbnail-page-maker.js';
import ThumbnailManager from './thumbnail-manager.js';
import ThumbnailRenderer from './thumbnail-renderer.js';
import NativeFolder from './native-folder.js';
import ArchiveFolder from './archive-folder.js';
import VirtualFolder from './virtual-folder.js';
import { isVirtualFolderKey, virtualFolderIdFromKey } from './virtual-folder-key.js';
import appdata from '../../lib/appdata.js';
import debug from '../../lib/debug.js';
import * as sizing from '../../lib/sizing.js';
import * as utils from '../../lib/utils.js';
import MediaManagerServer from './media-manager-server.js';
import ImageLoader from './image-loader.js';
import WatcherManager from '../../lib/watcher/watcher-manager.js';
import createThrottledReaddir from '../../lib/readdir-throttler.js';
//import stacktraceLog from '../../lib/stacktrace-log.js'; // eslint-disable-line
import { ProgOptions } from '../../main/program-options.js';
import { Preferences } from '../prefs/default-prefs.js';
import { watchVolumes } from '../../lib/volume-watcher.js';
import '../../lib/title.js';

console.log('page: thumber');

const isDevMode = process.env.NODE_ENV === 'development';

// Prevent the thumber process from crashing when a volume disappears.
// Filesystem operations on vanished paths throw errors that bubble up as
// unhandled exceptions/rejections.
process.on('uncaughtException', (err) => {
  console.error('thumber uncaughtException:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('thumber unhandledRejection:', err);
});

const windowTrackerIsAnyWindowFullScreen = () => win.isAnyWindowFullScreen();

type G = {
  dataDir: string;
  maxParallelDownloads: number;
  maxSeekTime: number;
  maxWidth: number;
  thumbCtx: CanvasRenderingContext2D;
  visible: boolean;
  hideTimeoutDuration: number;
  prefs?: Preferences;
  watcherManager: WatcherManager;
  mediaManagerServer: MediaManagerServer;
  thumbnailManager: ThumbnailManager
  thumbnailPageMaker: ReturnType<typeof createThumbnailPageMaker>;
  thumbnailPageMakerManager: LimitedResourceManager<ReturnType<typeof createThumbnailPageMaker>>;

  channel: otherWindowIPC.Channel;
  prefsStream: otherWindowIPC.ChannelStream;
};

function start(args: ProgOptions) {
  const log = debug('Thumber');
  log('start');
  const g = {
    dataDir: args.userDataDir ? args.userDataDir : path.join(appdata.localAppDataDir, 'Goon'),
    maxParallelDownloads: 4,
    maxSeekTime: 30,
    // TODO: fix
    maxWidth: 256,
    thumbCtx: document.querySelector('canvas')!.getContext('2d')!,
    visible: false,
    hideTimeoutDuration: isDevMode ? 5000000000 : 5000,  // 5 seconds
  } as G;

  //g.window.show();

  const hide = debounce(() => {
    if (g.visible) {
      g.visible = false;
      win.hideWindow();
    }
  }, g.hideTimeoutDuration);

  function clearProgressImage() {
    const ctx = g.thumbCtx;
    const dstWidth = ctx.canvas.width;
    const dstHeight = ctx.canvas.height;
    ctx.clearRect(0, 0, dstWidth, dstHeight);
  }

  function show() {
    if (!g.visible && g.prefs && g.prefs.misc.showThumber && !windowTrackerIsAnyWindowFullScreen()) {
      g.visible = true;
      win.showWindowInactive();
    }
    hide();  // works because this is debounced
  }

  function drawProgressImage(info: { width: number; height: number }, canvas: HTMLCanvasElement) {
    const ctx = g.thumbCtx;
    utils.resizeCanvasToDisplaySize(ctx.canvas, window.devicePixelRatio);
    clearProgressImage();
    const dstWidth = ctx.canvas.width;
    const dstHeight = ctx.canvas.height;
    const size = sizing.stretch(info.width, info.height, dstWidth, dstHeight);
    ctx.drawImage(
      canvas,
      (dstWidth - size.width) / 2,
      (dstHeight - size.height) / 2,
      size.width,
      size.height
    );
    show();
  }

  function make2DContext(settings?: CanvasRenderingContext2DSettings ) {
    return document.createElement('canvas').getContext('2d', settings) as CanvasRenderingContext2D;
  }

  g.watcherManager = new WatcherManager();
  function createWatcher(filepath: string) {
    return g.watcherManager.watch(filepath);
  }

  const thumbnailRendererMgr = createLimitedResourceManager([new ThumbnailRenderer(make2DContext())]);
  const loaders = utils.range(g.maxParallelDownloads, () => createMediaLoader({
    maxSeekTime: g.maxSeekTime,
  }));

  const localFS = {
    existsSync: fs.existsSync.bind(fs),
    readdir: createThrottledReaddir(fs.readdir.bind(fs), args.maxParallelReaddirs, args.readdirsThrottleDuration),
    readFileAsStringSync: (filename: string) => fs.readFileSync(filename, { encoding: 'utf-8' }),
    stat: fs.stat.bind(fs),
    statSync: fs.statSync.bind(fs),
    unlinkSync: fs.unlinkSync.bind(fs),
    writeFileSync: (filename: string, data: string | Buffer) => {
      fs.writeFileSync(filename, data);
    },
    writeFileBase64Sync: (filename: string, data: string) => {
      fs.writeFileSync(filename, data, 'base64');
    },
  };

  const thumbnailMaker = createThumbnailMaker({
    maxWidth: g.maxWidth,
    mediaLoaderManager: createLimitedResourceManager(loaders),
    thumbnailRendererManager: thumbnailRendererMgr,
  });
  g.thumbnailPageMaker = createThumbnailPageMaker({
    thumbnailMaker: thumbnailMaker,
    thumbnailWidth: g.maxWidth,
    pageSize: 2048,
    fs: localFS,
    context2DFactory: make2DContext,
    imgLoader: new ImageLoader(),
    thumbnailObserver: drawProgressImage,
  });
  g.thumbnailPageMakerManager = createLimitedResourceManager([
    g.thumbnailPageMaker,
  ]);

  g.thumbnailManager = new ThumbnailManager({
    dataDir: g.dataDir,
    thumbnailPageMakerManager: g.thumbnailPageMakerManager,
    fs: localFS,
    watcherFactory: createWatcher,
    nativeFolderFactory: (filepath, options) => new NativeFolder(filepath, options),
    archiveFolderFactory: (filepath, options) => new ArchiveFolder(filepath, options),
    virtualFolderFactory: (id, options) => new VirtualFolder(id, options),
  });
  // Instantiate any virtual folders the user has previously created.
  g.thumbnailManager.loadVirtualFolders();
  const updateFilesEventForwarder = makeEventForwarder('updateFiles');
  g.thumbnailManager.on('updateFiles', (folders, ...args) => {
    updateFilesEventForwarder(folders, ...args);
  });

  function updatePrefs(prefs: Preferences) {
    g.prefs = prefs;
    const isPrefs = !args._.length;
    const dirs = isPrefs ? prefs.folders : args._;
    //g.dirsToPrefixMap = Object.entries(utils.dirsToPrefixMap(dirs))
    //  .sort((a, b) => Math.sign(b.length - a.length));
    g.thumbnailManager.setFolders(utils.removeChildFolders(utils.filterNonExistingDirs(dirs)), isPrefs);
    // setFolders may have populated freshly-added folders entirely from
    // cache. The watchers won't refire `files` events in that case, so any
    // already-connected target that issued `requestAll` before prefs
    // arrived would still see an empty view. Push the current snapshot
    // explicitly to all targets to close that race.
    // (`targets` is declared further down — fine at runtime because
    //  updatePrefs only runs after prefs arrive, well after init.)
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    targets.forEach((target) => g.thumbnailManager.sendAll(target));
  }

  function refreshFolders() {
    if (g.prefs) {
      updatePrefs(g.prefs);
    }
  }

  watchVolumes(refreshFolders);

  otherWindowIPC.createChannelStream('prefs')
    .then((stream) => {
      g.prefsStream = stream;
      g.prefsStream.on('prefs', updatePrefs);
      // Pull the current prefs after attaching the listener; otherwise a
      // push-on-connect would race the listener wiring above.
      g.prefsStream.send('requestPrefs');
    })
    .catch((err) => {
      console.error(err);
      if (err.stack) {
        console.error(err.stack);
      }
    });

  const targets: ChannelStream[] = [];

  function makeEventForwarder(eventName: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (...args: any[]) => {
      log('send:', eventName, 'to', targets.length, 'targets');
      targets.forEach((target) => {
        target.send(eventName, ...args);
      });
    };
  }

  function virtualFolderState() {
    return {
      list: g.thumbnailManager.listVirtualFolders(),
      recent: g.thumbnailManager.getRecentVirtualFolders(),
    };
  }

  // Broadcast the current virtual-folder list + recents to every connected view so
  // the picker/sidebar stay in sync after a create/add/delete.
  function sendVirtualFolders() {
    const state = virtualFolderState();
    targets.forEach((target) => target.send('virtualFolders', state));
  }

  g.mediaManagerServer = new MediaManagerServer();

  g.channel = otherWindowIPC.createChannel('thumber');
  g.channel.on('connect', (stream) => {
    log('connect');
    targets.push(stream);
    stream.on('disconnect', () => {
      const ndx = targets.indexOf(stream);
      if (ndx < 0) {
        throw new Error('unknown stream');
      }
      targets.splice(ndx, 1);
    });
    stream.on('refreshFolder', (folderName: string) => {
      g.thumbnailManager.refreshFolder(folderName);
    });
    stream.on('refreshFolders', () => {
      refreshFolders();
    });
    // Act on (folderKey, filename) entries. The thumber routes each: a `vfolder:`
    // key removes the entry from that virtual folder (the real file is untouched);
    // a real key permanently deletes the file (fs, via main) and proactively updates
    // folder data so thumbnails disappear without waiting for the watcher — which
    // also drops it from any virtual folders that referenced it. Acks `filesDeleted`
    // so the view can clear its "deleting" overlay.
    stream.on('deleteEntries', async (entries: { folderKey: string; filename: string }[]) => {
      for (const { folderKey, filename } of entries) {
        if (isVirtualFolderKey(folderKey)) {
          const id = virtualFolderIdFromKey(folderKey);
          if (id) g.thumbnailManager.removeFileFromVirtualFolder(id, filename);
        } else {
          try {
            await ipcRenderer.invoke('deleteFile', filename);
            g.thumbnailManager.removeFile(filename);
          } catch (err) {
            log('deleteFile failed:', filename, err);
          }
        }
      }
      stream.send('filesDeleted', entries.map(e => e.filename));
    });
    // Delete a folder-like entry. Virtual folders delete themselves; otherwise the
    // thumber disambiguates: a directory is recursively removed; anything else (an
    // archive is a single file on disk) is unlinked and proactively removed.
    stream.on('deleteFolder', async (folderKey: string) => {
      if (isVirtualFolderKey(folderKey)) {
        const id = virtualFolderIdFromKey(folderKey);
        if (id) g.thumbnailManager.deleteVirtualFolder(id);
        sendVirtualFolders();
        return;
      }
      try {
        if (fs.statSync(folderKey).isDirectory()) {
          await ipcRenderer.invoke('deleteFolder', folderKey);
        } else {
          await ipcRenderer.invoke('deleteFile', folderKey);
          g.thumbnailManager.removeFile(folderKey);
        }
      } catch (err) {
        log('deleteFolder failed:', folderKey, err);
      }
    });
    // ── Virtual folder management (view → thumber) ──────────────────────
    stream.on('requestVirtualFolders', () => stream.send('virtualFolders', virtualFolderState()));
    stream.on('createVirtualFolder', (name: string) => {
      g.thumbnailManager.createVirtualFolder(name);
      sendVirtualFolders();
    });
    stream.on('addToVirtualFolder', (id: string, paths: string[]) => {
      g.thumbnailManager.addFilesToVirtualFolder(id, paths);
      sendVirtualFolders();
    });
    stream.on('addToNewVirtualFolder', (name: string, paths: string[]) => {
      const id = g.thumbnailManager.createVirtualFolder(name);
      g.thumbnailManager.addFilesToVirtualFolder(id, paths);
      sendVirtualFolders();
    });
    stream.on('removeFromVirtualFolder', (id: string, filePath: string) => {
      g.thumbnailManager.removeFileFromVirtualFolder(id, filePath);
    });
    // Pull-based init: the renderer asks for the current snapshot once it
    // has its 'updateFiles' listener attached. Pushing on connect would race
    // the renderer's listener wiring (which happens in a React effect).
    stream.on('requestAll', () => {
      g.thumbnailManager.sendAll(stream);
    });
  });
  window.addEventListener('beforeunload', () => {
    targets.slice().forEach((target) => {
      target.close();
    });
    g.channel.close();
    g.mediaManagerServer.close();
    g.watcherManager.close();
  });
}

ipcRenderer.on('start', (event, args) => {
  setTimeout(() => {
    start(args);
  }, 500);
});
ipcRenderer.send('start');
