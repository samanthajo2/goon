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

import {BrowserWindow, ipcRenderer} from 'electron'; // eslint-disable-line
import {getCurrentWindow, require as req} from '@electron/remote';
import otherWindowIPC, { ChannelStream } from 'other-window-ipc';
import fs from 'graceful-fs';
import path from 'path';
import _ from 'lodash';

import createLimitedResourceManager, { LimitedResourceManager } from '../../lib/limited-resource-manager';
import createMediaLoader from './media-loader';
import createThumbnailMaker from './thumbnail-maker';
import createThumbnailPageMaker from './thumbnail-page-maker';
import ThumbnailManager from './thumbnail-manager';
import ThumbnailRenderer from './thumbnail-renderer';
import appdata from '../../lib/appdata';
import debug from '../../lib/debug';
import * as sizing from '../../lib/sizing';
import * as utils from '../../lib/utils';
import MediaManagerServer from './media-manager-server';
import ImageLoader from './image-loader';
import WatcherManager from '../../lib/watcher/watcher-manager';
import createThrottledReaddir from '../../lib/readdir-throttler';
//import stacktraceLog from '../../lib/stacktrace-log'; // eslint-disable-line
import { ProgOptions } from '../../main/program-options';
import { Preferences } from '../prefs/default-prefs';
import '../../lib/title';

const isDevMode = process.env.NODE_ENV === 'development';

const {windowTrackerIsAnyWindowFullScreen} = req('./out/js/src/js/lib/remote-helpers');

type G = {
  dataDir: string;
  maxParallelDownloads: number;
  maxSeekTime: number;
  maxWidth: number;
  thumbCtx: CanvasRenderingContext2D;
  visible: boolean;
  window: BrowserWindow;
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
    window: getCurrentWindow(),
    hideTimeoutDuration: isDevMode ? 5000000000 : 5000,  // 5 seconds
  } as G;

  //g.window.show();

  const hide = _.debounce(() => {
    if (g.visible) {
      g.visible = false;
      g.window.hide();
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
      g.window.showInactive();
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
    readdir: createThrottledReaddir(fs.readdir.bind(fs), args.maxParallelReaddirs, args.readdirsThrottleDuration),
    readFileSync: fs.readFileSync.bind(fs),
    unlinkSync: fs.unlinkSync.bind(fs),
    writeFileSync: (filename: string, data: string, encoding?: string) => {
      fs.writeFileSync(filename, data, { encoding: encoding as BufferEncoding });
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
    fs: fs,
    watcherFactory: createWatcher,
  });
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
  }

  otherWindowIPC.createChannelStream('prefs')
    .then((stream) => {
      g.prefsStream = stream;
      g.prefsStream.on('prefs', updatePrefs);
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
    g.thumbnailManager.sendAll(stream);
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
