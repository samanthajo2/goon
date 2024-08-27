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

import {ipcRenderer} from 'electron'; // eslint-disable-line
import {getCurrentWindow, require as req} from '@electron/remote';
import otherWindowIPC from 'other-window-ipc';
import fs from 'graceful-fs';
import path from 'path';
import _ from 'lodash';
import crypto from 'crypto';

import createLimitedResourceManager from '../../lib/limited-resource-manager';
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
import {checkPassword} from '../../lib/password-utils';
import stacktraceLog from '../../lib/stacktrace-log'; // eslint-disable-line
import '../../lib/title';

const isDevMode = process.env.NODE_ENV === 'development';

const {windowTrackerIsAnyWindowFullScreen} = req('./out/js/lib/remote-helpers');

function start(args) {
  const log = debug('Thumber');
  log('start');
  const g = {
    dataDir: args.userDataDir ? args.userDataDir : path.join(appdata.localAppDataDir, 'Goon'),
    maxParallelDownloads: 4,
    maxSeekTime: 30,
    // TODO: fix
    maxWidth: 256,
    thumbCtx: document.querySelector('canvas').getContext('2d'),
    visible: false,
    window: getCurrentWindow(),
    hideTimeoutDuration: isDevMode ? 5000000000 : 5000,  // 5 seconds
  };

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

  function drawProgressImage(info, canvas) {
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

  function make2DContext(...args) {
    return document.createElement('canvas').getContext('2d', ...args);
  }

  g.watcherManager = new WatcherManager();
  function createWatcher(filepath) {
    return g.watcherManager.watch(filepath);
  }

  const thumbnailRendererMgr = createLimitedResourceManager([new ThumbnailRenderer(document.createElement('canvas').getContext('2d'))]);
  const loaders = [];
  for (let ii = 0; ii < g.maxParallelDownloads; ++ii) {
    loaders.push(createMediaLoader({
      maxSeekTime: g.maxSeekTime,
    }));
  }

  fs.readdir = createThrottledReaddir(fs.readdir.bind(fs), args.maxParallelReaddirs, args.readdirsThrottleDuration);

  const thumbnailMaker = createThumbnailMaker({
    maxWidth: g.maxWidth,
    mediaLoaderManager: createLimitedResourceManager(loaders),
    thumbnailRendererManager: thumbnailRendererMgr,
  });
  g.thumbnailPageMaker = createThumbnailPageMaker({
    thumbnailMaker: thumbnailMaker,
    thumbnailWidth: g.maxWidth,
    pageSize: 2048,
    fs: fs,
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

  function updatePrefs(prefs) {
    g.prefs = prefs;
    const isPrefs = !args._.length;
    const dirs = isPrefs ? prefs.folders : args._;
    g.dirsToPrefixMap = Object.entries(utils.dirsToPrefixMap(dirs))
      .sort((a, b) => Math.sign(b.length - a.length));
    g.thumbnailManager.setFolders(utils.removeChildFolders(utils.filterNonExistingDirs(dirs)), isPrefs);
  }

  function pathToPrefix(path) {
    for (const [dir, prefix] of g.dirsToPrefixMap) {
      if (path.startsWith(dir)) {
        return `/${prefix}${path.substring(dir.length)}`;
      }
    }
    return path;
  }

  function prepFoldersForBrowser(folders) {
    const preppedFolders = {};
    for (const [folderName, folder] of Object.entries(folders)) {
      const f = _.cloneDeep(folder);
      for (const [fileName, file] of Object.entries(f.files)) {
        if (file.thumbnail && file.thumbnail.url && file.thumbnail.url.startsWith(g.dataDir)) {
          file.thumbnail.url = `/user-data-dir${file.thumbnail.url.substring(g.dataDir.length)}`;
        }
        if (!file.url) {
          file.url = pathToPrefix(fileName);
        }
      }
      preppedFolders[folderName] = f;
    }
    return preppedFolders;
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

  const targets = [];

  function makeEventForwarder(eventName) {
    return (...argss) => {
      log('send:', eventName, 'to', targets.length, 'targets');
      targets.forEach((target) => {
        target.send(eventName, ...argss);
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
    stream.on('refreshFolder', (folderName) => {
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
