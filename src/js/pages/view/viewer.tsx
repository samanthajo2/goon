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

import React from 'react';
import _ from 'lodash';
import { autorun, action } from 'mobx';
import { ipcRenderer } from 'electron';  // eslint-disable-line
import { observer } from 'mobx-react';
import ResizeSensor from '../../lib/ui/resize-sensor';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher';
import ForwardableEvent from '../../lib/forwardable-event';
import ListenerManager from '../../lib/listener-manager';
import ActionListener from '../../lib/action-listener';
import * as sizing from '../../lib/sizing';
import debug from '../../lib/debug';
import Player from './player';
import * as filters from '../../lib/filters';
import { CSSArray } from '../../lib/css-utils';
import { px, euclideanModulo } from '../../lib/utils';
import { getOrientationInfo } from '../../lib/rotatehelper';
import { createImageFromString } from '../../lib/string-image';
import MediaManagerClient from '../../lib/media-manager-client';
import { Preferences } from '../prefs/default-prefs';
import { VideoState, TimeUpdateEvent } from './viewer-events';
import { MediaResult } from '../../lib/media-manager-types';

let s_viewerCount = 0;

const modeNames = [
  'actualSize',
  'fitWidth',
  'fitHeight',
  'constrain',
  'stretch',
  'cover',
] as const;

type StretchMode = typeof modeNames[number];

const modeInfo: Record<StretchMode, { desc: string; image: string }> = {
  'actualSize': { desc: 'actual size',                            image: 'images/stretch-none.svg' },
  'fitWidth':   { desc: 'fit width',                              image: 'images/stretch-horizontal.svg' },
  'fitHeight':  { desc: 'fit height',                             image: 'images/stretch-vertical.svg' },
  'constrain':  { desc: 'constrain (actual size unless too big)', image: 'images/stretch-both.svg' },
  'stretch':    { desc: 'stretch (scale fits in container)',      image: 'images/stretch-stretch.svg' },
  'cover':      { desc: 'cover (scale so container is covered)',  image: 'images/stretch-cover.svg' },
};

type ThrottleFn = ((...args: unknown[]) => void) & { cancel: () => void };

function throttle(fn: (...args: unknown[]) => void, timeout: number): ThrottleFn {
  let id: ReturnType<typeof setTimeout> | undefined;
  let args: unknown[];
  let once: boolean | undefined;

  const execute = () => {
    id = undefined;
    fn(...args);
  };

  const tFn = (...a: unknown[]) => {
    args = a;
    if (!id) {
      const tm = once ? timeout : 0;
      once = true;
      id = setTimeout(execute, tm);
    }
  };

  tFn.cancel = () => {
    if (id) {
      clearTimeout(id);
      id = undefined;
      once = undefined;
    }
  };

  return tFn;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function isRotated90(rotation: number): boolean {
  assert(rotation >= 0 && rotation <= 7, 'rotation must be between 0 and 7');
  return rotation % 2 === 1;
}

type FileInfo = {
  width: number;
  height: number;
  filename: string;
  baseName?: string;
  type: string;
  orientation?: number;
  bad?: boolean;
};

type Size = { width: number; height: number };

type TransformInfo = {
  x: number;
  y: number;
  scale: number;
  s: { x: number; y: number; w: number; h: number; [key: string]: number };
  displayCenter: { x: number; y: number };
  imgDisplay: { w: number; h: number; [key: string]: number };
  orig: { centerX: number; centerY: number; w: number; h: number };
  newMin: { x: number; y: number; [key: string]: number };
  [key: string]: unknown;
};

function computeTransformAtCenter({ fileInfo, size, containerSize, zoom, rotation }: {
  fileInfo: FileInfo;
  size: Size;
  containerSize: Size;
  zoom: number;
  rotation: number;
}): TransformInfo {
  const [srcWidth, srcHeight] = isRotated90(rotation)
    ? [fileInfo.height, fileInfo.width]
    : [fileInfo.width, fileInfo.height];
  const sx = size.width / srcWidth;
  const sy = size.height / srcHeight;
  const scale = Math.max(sx, sy) * zoom;

  // If we did nothing, no scale, no translation, it would be here
  //
  //     +----+-------+
  //     |    |       |
  //     |    |       |
  //     |    |       |
  //     +----+       |
  //     |            |
  //     +------------+
  //
  // After scaling it could be one of these because it scales around the center of the image
  //
  //                         +------+
  //     +------------+      |+-----+------+
  //     |+--+        |      ||     |      |
  //     ||  |        |      ||     |      |
  //     ||  |        |  or  ||     |      |
  //     |+--+        |      ||     |      |
  //     |            |      ++-----+      |
  //     +------------+       +------------+
  //
  const displayCenterX = containerSize.width / 2;
  const displayCenterY = containerSize.height / 2;

  const [imgDisplayWidth, imgDisplayHeight] = isRotated90(rotation)
    ? [size.height, size.width]
    : [size.width, size.height];

  const origCenterX = fileInfo.width / 2;
  const origCenterY = fileInfo.height / 2;

  const x = displayCenterX - origCenterX;
  const y = displayCenterY - origCenterY;

  const newLeft = origCenterX + x - (imgDisplayWidth / 2);
  const newTop  = origCenterY + y - (imgDisplayHeight / 2);

  return {
    x,
    y,
    scale,
    s: { x: sx, y: sy, w: fileInfo.width * scale, h: fileInfo.height * scale },
    displayCenter: { x: displayCenterX, y: displayCenterY },
    imgDisplay: { w: imgDisplayWidth, h: imgDisplayHeight },
    orig: { centerX: origCenterX, centerY: origCenterY, w: fileInfo.width, h: fileInfo.height },
    newMin: { x: newLeft, y: newTop },
  };
}

function moveIfOffScreen(t: TransformInfo, axis: 'x' | 'y'): void {
  if (t.newMin[axis] < 0) {
    if (axis === 'x') t.x -= t.newMin[axis];
    else t.y -= t.newMin[axis];
  }
}

function adjustToCenter(
  t: TransformInfo,
  axis: 'x' | 'y',
  dim: 'w' | 'h',
  winSize: number,
  winScroll: number,
): number {
  let scrollBy = 0;
  let delta = t.imgDisplay[dim] - winSize;
  if (delta > 0) {
    if (axis === 'x') t.x -= delta / 2;
    else t.y -= delta / 2;
  }
  if (t.newMin[axis] < 0) {
    scrollBy = -t.newMin[axis];
  } else {
    const newMax = t.newMin[axis] + t.s[dim];
    const winBot = winScroll + winSize;
    delta = newMax - winBot;
    if (delta > 0) {
      scrollBy = -delta;
    }
  }
  return scrollBy;
}

function getFlip(rotation: number): [number, number] {
  return [
    rotation & 4 ? -1 : 1,
    rotation & 8 ? -1 : 1,
  ];
}

function setTransform(
  t: TransformInfo,
  { containerSize, rotation, baseScale }: { containerSize: Size; rotation: number; zoom?: number; baseScale: [number, number] },
  style: Record<string, string | number>,
): void {
  const scrollLeft = 0;
  const scrollTop  = 0;
  adjustToCenter(t, 'x', 'w', containerSize.width,  scrollLeft);
  adjustToCenter(t, 'y', 'h', containerSize.height, scrollTop);
  const translationPart = `translate(${px(t.x + scrollLeft)},${px(t.y + scrollTop)})`;
  const scalePart = `scale(${Math.max(t.scale)})`;
  const rotatePart = `rotate(${rotation % 4 * 90}deg)`;
  const flipPart = `scale(${getFlip(rotation).map((s, i) => s * baseScale[i]).join(',')})`;
  style.transform = `${translationPart} ${rotatePart} ${scalePart} ${flipPart}`;
}

type ViewerState = {
  viewing: boolean;
  mimeType: string;
  filename?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fileInfo: any;
  rotation: number;
  stretchMode: string;
  zoom: number;
  slideshow: boolean;
  videoState: VideoState;
};

type Options = {
  columnWidth: number;
  padding: number;
  maxSeekTime: number;
};

type Props = {
  options: Options;
  eventBus: ForwardableEventDispatcher;
  downstreamEventBus: ForwardableEventDispatcher;
  viewerState: ViewerState;
  prefs: Preferences;
  mediaManager: MediaManagerClient;
  setCurrentView: () => void;
  rotateMode: number;
};

type State = {
  width: number;
  height: number;
  id: number;
  infoFlash: boolean;
  playerFlash: boolean;
};

@observer
export default class Viewer extends React.Component<Props, State> {
  private _id: number;
  private _logger: ReturnType<typeof debug>;
  private _baseRotation: number;
  private _baseScale: [number, number];
  private _listenerManager: ListenerManager;
  private _eventBus: ForwardableEventDispatcher;
  private _actionListener!: ActionListener;
  private _currentFilename: string;
  private _currentFileInfo: FileInfo | undefined;
  private _pendingFileInfo!: FileInfo;
  private _viewerElem!: HTMLDivElement;
  private _viewImg!: HTMLImageElement;
  private _viewVideo!: HTMLVideoElement;
  private _displayElem: HTMLImageElement | HTMLVideoElement | undefined;
  private _slideshow: boolean;
  private _slideshowId: ReturnType<typeof setTimeout> | undefined;
  private _processWheelTick: (delta: number) => boolean | 0;

  constructor(props: Props) {
    super(props);
    this._id = s_viewerCount++;
    this._logger = debug('Viewer', s_viewerCount);
    this._logger('ctor');
    this._baseRotation = 0;
    this._baseScale = [1, 1];
    this._listenerManager = new ListenerManager();
    this._currentFilename = '';
    this._slideshow = false;
    this._eventBus = new ForwardableEventDispatcher();
    this._eventBus.debugId = this._logger.getPrefix();

    {
      let lastDeltaSign = 0;
      let tickOk = false;
      const tickHelper = throttle(() => { tickOk = true; }, 500);
      const unpressedHelper = _.debounce(() => { lastDeltaSign = 0; }, 50, { trailing: true });

      this._processWheelTick = (delta: number) => {
        const deltaSign = Math.sign(delta);
        if (deltaSign !== lastDeltaSign) {
          lastDeltaSign = deltaSign;
          unpressedHelper.cancel();
          tickHelper.cancel();
        }
        unpressedHelper();

        const tick = tickOk;
        tickOk = false;

        tickHelper();

        return lastDeltaSign ? tick : false;
      };
    }

    this.state = {
      width: 0,
      height: 0,
      id: 0,
      infoFlash: false,
      playerFlash: false,
    };

    this._loadMediaIfNew();
  }

  componentDidMount(): void {
    const on = this._listenerManager.on.bind(this._listenerManager);
    const viewerElem = this._viewerElem;
    const $ = viewerElem.parentElement!.querySelector.bind(viewerElem.parentElement!);
    this._viewImg = $<HTMLImageElement>('.viewer-img')!;
    this._viewVideo = $<HTMLVideoElement>('.viewer-video')!;

    const video = this._viewVideo;
    on(video, 'loadeddata', this._handleLoadedData);
    on(video, 'timeupdate', this._handleTimeUpdate);
    on(viewerElem, 'wheel', this._handleWheel);

    autorun(() => {
      video.volume = this.props.viewerState.videoState.volume;
    });

    on(this._viewImg, 'load', () => {
      this._logger('imageLoad');
      this._displayElem = this._viewImg;
      this._updateViewStateAfterMediaLoad();
    });

    const createSetPlaybackRateFn = (rate: number) => () => {
      this._setPlaybackRate(rate);
    };

    const actionListener = new ActionListener();
    this._actionListener = actionListener;
    actionListener.on('closeViewer', () => { this._hideImage(); });
    actionListener.on('zoomIn', () => { this._zoom(0.1); });
    actionListener.on('zoomOut', () => { this._zoom(-0.1); });
    actionListener.on('setLoop', () => { this._loop(); });
    actionListener.on('gotoPrev', () => { this._gotoPrev(); });
    actionListener.on('gotoNext', () => { this._gotoNext(); });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actionListener.on('togglePlay', (fe: any) => { this._togglePlay(fe); });
    actionListener.on('fastForward', () => { this._cueOrNextPrev(this.props.prefs.misc.stepForwardDuration); });
    actionListener.on('fastBackward', () => { this._cueOrNextPrev(-this.props.prefs.misc.stepBackwardDuration); });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actionListener.on('scrollUp', (fe: any) => {
      fe.domEvent.stopPropagation();
      window.scrollBy(0, this.state.height / -4 | 0);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actionListener.on('scrollDown', (fe: any) => {
      fe.domEvent.stopPropagation();
      window.scrollBy(0, this.state.height / 4 | 0);
    });
    actionListener.on('setPlaybackSpeed1', createSetPlaybackRateFn(1   ));
    actionListener.on('setPlaybackSpeed2', createSetPlaybackRateFn(0.66));
    actionListener.on('setPlaybackSpeed3', createSetPlaybackRateFn(0.5 ));
    actionListener.on('setPlaybackSpeed4', createSetPlaybackRateFn(0.33));
    actionListener.on('setPlaybackSpeed5', createSetPlaybackRateFn(0.25));
    actionListener.on('cyclePlaybackSpeed', this._cyclePlaybackSpeed);
    actionListener.on('toggleSlideshow', () => { this.toggleSlideshow(); });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actionListener.on('rotate', (fe: any) => { fe.stopPropagation(); this._rotate(); });
    actionListener.on('changeStretchMode', () => { this._changeStretchMode(); });
    actionListener.on('launchBrowser', this._launchBrowser);
    on(this._eventBus, 'action', this._actionListener.routeAction);

    this._logger('register for action on emitter:', this.props.eventBus.debugId);
    on(this._eventBus, 'timeupdate', this._setVideoTime);
    on(this._eventBus, 'releaseMedia', this._releaseMedia);

    this.props.eventBus.setForward(this._eventBus);
  }

  componentWillUnmount(): void {
    this._logger('close');
    this._clearSlideshow();
    this._actionListener.close();
    this.props.eventBus.setForward(null);
    this._listenerManager.removeAll();
  }

  @action private _setPlaybackRate(rate: number): void {
    const video = this._viewVideo;
    video.playbackRate = rate;
    this.props.viewerState.videoState.playbackRate = rate;
  }

  private _cyclePlaybackSpeed = (): void => {
    const speeds = [1, 0.66, 0.5, 0.33, 0.25];
    const video = this._viewVideo;
    const ndx = (speeds.indexOf(video.playbackRate) + 1) % speeds.length;
    this._setPlaybackRate(speeds[ndx]);
  };

  @action private _handleLoadedData = (): void => {
    const { viewerState } = this.props;
    const videoState = viewerState.videoState;
    const video = this._viewVideo;
    this._displayElem = video;
    videoState.duration = video.duration;
    if (videoState.loop === 2 && videoState.currentUrl === video.src) {
      video.currentTime = videoState.loopStart;
    }
    videoState.currentUrl = video.src;
    this._updateViewStateAfterMediaLoad();
    this._play();
  };

  @action private _updateViewStateAfterMediaLoad(): void {
    const good = !this._pendingFileInfo.bad;
    const fileInfo: FileInfo = good ? this._pendingFileInfo : {
      bad: true,
      type: 'image/png',
      filename: this._pendingFileInfo.filename,
      width: 256,
      height: 256,
    };
    this._currentFileInfo = fileInfo;

    const orientInfo = getOrientationInfo(fileInfo, fileInfo.orientation ?? 0);
    this._baseRotation = orientInfo.rotation;
    this._baseScale = orientInfo.scale;

    this.props.viewerState.filename = fileInfo.filename;
    this.props.viewerState.mimeType = fileInfo.type;

    this.setState(prevState => ({ id: prevState.id + 1 }));
  }

  @action private _handleTimeUpdate = (): void => {
    const video = this._viewVideo;
    const videoState = this.props.viewerState.videoState;
    if (videoState.loop === 2) {
      if (video.currentTime >= videoState.loopEnd) {
        video.currentTime = videoState.loopStart;
      }
    }
    videoState.time = video.currentTime;
  };

  private _handleWheel = (event: Event): void => {
    const e = event as WheelEvent;
    const delta = e.deltaX;
    const threshold = 5;
    const deltaRange = 100;
    const maxCue = 50;

    if (Math.abs(delta) > threshold) {
      const amount = Math.sign(delta) * Math.abs(delta) - threshold;
      if (this._processWheelTick(amount)) {
        this._cueOrNextPrev(amount / deltaRange * maxCue);
      }
    }
  };

  private _handleContextMenu = (event: React.MouseEvent): void => {
    this._eventBus.dispatch(new ForwardableEvent('fileContextMenu', event.nativeEvent), this._currentFileInfo);
  };

  private _bumpId(): void {
    this.setState(prevState => ({ id: prevState.id + 1 }));
  }

  private _adjustSize(
    { fileInfo, stretchMode, rotation, zoom, baseScale }: {
      fileInfo: FileInfo;
      stretchMode: string;
      rotation: number;
      zoom: number;
      baseScale: [number, number];
    },
    style: Record<string, string | number>,
  ): void {
    const containerSize = this._getDisplayDimensions();
    const [srcWidth, srcHeight] = isRotated90(rotation)
      ? [fileInfo.height, fileInfo.width]
      : [fileInfo.width, fileInfo.height];
    const sizeFn = (sizing as Record<string, (sw: number, sh: number, dw: number, dh: number) => Size>)[stretchMode];
    const size = sizeFn(srcWidth, srcHeight, containerSize.width, containerSize.height);
    const t = computeTransformAtCenter({ fileInfo, size, containerSize, rotation, zoom });
    moveIfOffScreen(t, 'x');
    moveIfOffScreen(t, 'y');
    setTransform(t, { containerSize, rotation, zoom, baseScale }, style);
    style.width = px(fileInfo.width);
    style.height = px(fileInfo.height);
  }

  @action private _changeStretchMode = (): void => {
    const newModeNdx = (modeNames.indexOf(this.props.viewerState.stretchMode as StretchMode) + 1) % modeNames.length;
    this.props.viewerState.stretchMode = modeNames[newModeNdx];
  };

  @action private _rotate = (): void => {
    this.props.viewerState.rotation = (this.props.viewerState.rotation + 1) % 8;
  };

  @action private _zoom(z: number): void {
    this.props.viewerState.zoom += z;
  }

  @action private _loop(): void {
    const videoState = this.props.viewerState.videoState;
    if (this._displayElem instanceof HTMLVideoElement) {
      switch (videoState.loop) {
        case 0: // not looping, set start
          videoState.loop = 1;
          videoState.loopStart = this._displayElem.currentTime;
          break;
        case 1: // start set, set end
          videoState.loop = 2;
          videoState.loopEnd = this._displayElem.currentTime;
          if (videoState.loopStart > videoState.loopEnd) {
            const t = videoState.loopStart;
            videoState.loopStart = videoState.loopEnd;
            videoState.loopEnd = t;
          }
          break;
        case 2:
          videoState.loop = 0;
          break;
        default:
          break;
      }
    }
  }

  private _handleResize = (contentRect: { client: { width: number; height: number } }): void => {
    this._logger('handleResize');
    if (this._displayElem &&
        (this.state.width !== contentRect.client.width ||
         this.state.height !== contentRect.client.height)) {
      this.setState({
        width: contentRect.client.width,
        height: contentRect.client.height,
      });
    }
  };

  nextSlide(): void {
    this._gotoNext();
  }

  @action private _setVideoTime = (event: ForwardableEvent): void => {
    const te = event as TimeUpdateEvent;
    const video = this._viewVideo;
    const videoState = this.props.viewerState.videoState;
    video.currentTime = Math.max(0, Math.min(te.time, video.duration));
    videoState.time = video.currentTime;
  };

  private _loadVideo(url: string): void {
    this._pause();
    const video = this._viewVideo;
    video.src = url;
    video.load();
  }

  @action private _play(): void {
    const video = this._viewVideo;
    const videoState = this.props.viewerState.videoState;
    video.play();
    video.playbackRate = videoState.playbackRate;
    videoState.playing = true;
  }

  @action private _pause(): void {
    const video = this._viewVideo;
    const videoState = this.props.viewerState.videoState;
    video.pause();
    videoState.playing = false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _togglePlay(actionEvent: any): void {
    const video = this._viewVideo;
    const play = actionEvent.action.force === undefined
      ? video.paused
      : actionEvent.action.force;
    if (play) {
      this._play();
    } else {
      this._pause();
    }
  }

  private _clearSlideshow(): void {
    this._slideshow = false;
    if (this._slideshowId) {
      clearTimeout(this._slideshowId);
      this._slideshowId = undefined;
    }
  }

  toggleSlideshow(): void {
    if (this._slideshow) {
      this._clearSlideshow();
    } else {
      this._slideshow = true;
      this._gotoNext();
    }
  }

  private _gotoNext = (): void => {
    this._eventBus.dispatch(new ForwardableEvent('gotoNext'));
  };

  private _gotoPrev = (): void => {
    this._eventBus.dispatch(new ForwardableEvent('gotoPrev'));
  };

  private _getDisplayDimensions(): Size {
    return {
      width: this.state.width,
      height: this.state.height,
    };
  }

  private _cue(seconds: number): void {
    if (this._displayElem instanceof HTMLVideoElement) {
      const newTime = euclideanModulo(this._displayElem.currentTime + seconds, this._displayElem.duration);
      this._logger('cue: oldTime:', this._displayElem.currentTime, 'newTime:', newTime);
      this._displayElem.currentTime = newTime;
    }
  }

  private _cueOrNextPrev(seconds: number): void {
    if (this._displayElem instanceof HTMLVideoElement) {
      this._cue(seconds);
    } else {
      if (seconds > 0) {
        this._gotoNext();
      } else {
        this._gotoPrev();
      }
    }
  }

  @action private _hideImage = (): void => {
    this._logger('hideImage');
    this._clearSlideshow();
    this._displayElem = undefined;
    this._eventBus.dispatch(new ForwardableEvent('hide'));
  };

  // Release file handles (video/img src) without closing the viewer.
  // Call this before trashing a file to ensure the OS file handle is freed,
  // particularly on Windows where Chromium holds video files open.
  @action private _releaseMedia = (): void => {
    this._logger('releaseMedia');
    this._pause();
    if (this._viewVideo) {
      this._viewVideo.removeAttribute('src');
      this._viewVideo.load();
    }
    if (this._viewImg) {
      this._viewImg.removeAttribute('src');
    }
    this._displayElem = undefined;
    this._currentFileInfo = undefined;
  };

  private _hidePlayer(): void {
    this.setState({ playerFlash: false });
  }

  private _hideInfo(): void {
    this.setState({ infoFlash: false });
  }

  private _launchBrowser = (): void => {
    ipcRenderer.invoke('launchBrowser', this.props.viewerState.filename);
  };

  @action private _showNewMedia(
    err: string | null | undefined,
    mediaInfo: MediaResult | undefined,
    fileInfo: FileInfo,
  ): void {
    const good = !err && !fileInfo.bad;
    const { url, type } = good && mediaInfo ? mediaInfo : { url: 'images/bad.png', type: 'image/png' };
    this._pendingFileInfo = fileInfo;

    if (filters.isMimeVideo(type) || filters.isMimeAudio(type)) {
      const videoState = this.props.viewerState.videoState;
      // we need this because we'll compare url to video.src and when applied to video src
      // some letters are escaped
      const u = new URL(url, window.location.href);
      if (videoState.currentUrl !== u.href) {
        this.props.viewerState.videoState.loop = 0;
      }
      this._pause();
      this._loadVideo(url);
    }
    if (filters.isMimeAudio(type)) {
      this._viewImg.src = createImageFromString(fileInfo.baseName ?? fileInfo.filename);
    }
    if (filters.isMimeImage(type)) {
      this._viewImg.src = url;
      this._pause();
    }

    if (this._slideshow) {
      const slideshowDuration = this.props.prefs.slideshowDuration;
      let timeout: number | undefined = (slideshowDuration as Record<string, number>)[type];
      if (!timeout) {
        const baseType = type.split('/')[0];
        timeout = (slideshowDuration as Record<string, number>)[baseType];
      }
      timeout = timeout || slideshowDuration.default;
      this._clearSlideshow();
      this._slideshow = true;
      this._slideshowId = setTimeout(this._gotoNext, timeout * 1000);
    }
  }

  viewImage(_event: ForwardableEvent, fileInfo: FileInfo): void {
    this.props.mediaManager.requestMedia(fileInfo, (err, mediaInfo) => {
      this._showNewMedia(err, mediaInfo, fileInfo);
    });
  }

  private _loadMediaIfNew(): void {
    const viewerState = this.props.viewerState;
    const fileInfo = viewerState.fileInfo as FileInfo;
    const filename = fileInfo.filename;
    if (this._currentFilename !== filename) {
      this._currentFilename = filename;
      this.props.mediaManager.requestMedia(fileInfo, (err, info) => {
        this._showNewMedia(err, info, fileInfo);
      });
    }
  }

  render(): React.ReactNode {
    this._logger('render');
    this._loadMediaIfNew();
    const { mimeType, stretchMode, filename, videoState, rotation: viewerRotation, zoom } = this.props.viewerState;
    const rotation = (this._baseRotation + viewerRotation) % 8;
    const isVideo = filters.isMimeVideo(mimeType);
    const isAudio = filters.isMimeAudio(mimeType);
    const isVideoOrAudio = isVideo || isAudio;
    const isImage = filters.isMimeImage(mimeType);
    const imageStyle: React.CSSProperties & Record<string, string | number> = {
      display: (isImage || isAudio) ? 'inline-block' : 'none',
    };
    const videoStyle: React.CSSProperties & Record<string, string | number> = {
      display: (isVideoOrAudio) ? 'inline-block' : 'none',
    };
    const elemStyle = isVideo ? videoStyle : imageStyle;
    const viewElemStyle: React.CSSProperties & Record<string, string | number> = {
      display: 'none',
    };
    if (this._displayElem) {
      const fileInfo = this._currentFileInfo!;
      viewElemStyle.display = 'block';
      this._adjustSize({ fileInfo, stretchMode, rotation, zoom, baseScale: this._baseScale }, elemStyle);
    }
    const infoClasses = new CSSArray('info');
    infoClasses.addIf(this.state.infoFlash, 'flash');
    const videoClasses = new CSSArray('pspot');
    videoClasses.addIf(!isVideoOrAudio, 'hide');
    videoClasses.addIf(this.state.playerFlash, 'flash');
    return (
      <ResizeSensor onResize={this._handleResize}>
        {({ measureRef }) => (
          <div
            style={viewElemStyle}
            className="viewer"
            ref={(viewer) => {
              if (viewer && viewer !== this._viewerElem) {
                this._viewerElem = viewer;
                measureRef(viewer);
              }
            }}
          >
            <div className="back" onClick={() => { this.props.setCurrentView(); }}></div>
            <div className="view-holder">
              <div className="viewer-content" onContextMenu={this._handleContextMenu}>
                <img style={imageStyle} className="viewer-img" draggable={false} alt="" />
                <video style={videoStyle} className="viewer-video" autoPlay loop draggable={false}></video>
              </div>
              <div className={infoClasses.toString()}>{filename}</div>
              <div className="prev" onClick={this._gotoPrev}><img src="images/prev.svg" /></div>
              <div className="next" onClick={this._gotoNext}><img src="images/next.svg" /></div>
              <div className="ui">
                <div className="stretch" onClick={this._changeStretchMode} title={stretchMode}>
                  <img src={modeInfo[stretchMode as StretchMode]?.image ?? ''} />
                </div>
                <div className="rotate" onClick={this._rotate}>
                  <img src="images/rotate.svg" />
                </div>
                <div className="close" onClick={this._hideImage}>
                  <img src="images/close.svg" />
                </div>
              </div>
              <div className={videoClasses.toString()}>
                <Player
                  videoState={videoState}
                  eventBus={this._eventBus}
                />
              </div>
            </div>
          </div>
        )}
      </ResizeSensor>
    );
  }
}
