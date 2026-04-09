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
import { uniqueId } from '../../lib/utils.js';
import debug from '../../lib/debug.js';
import { actions, ActionId } from '../../lib/actions.js';
import * as filters from '../../lib/filters.js';
import { TimeUpdateEvent, ViewerState, VideoState } from './viewer-events.js';
import { CSSArray } from '../../lib/css-utils.js';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher.js';
import ForwardableEvent from '../../lib/forwardable-event.js';
import type { AppEventMap } from './app-event-map.js';

type RangeProps = {
  value: number;
  min: number | string;
  max: number | string;
  onUpdate: React.ChangeEventHandler<HTMLInputElement>;
};

class Range extends React.Component<RangeProps> {
  private id: string;
  constructor(props: RangeProps) {
    super(props);
    this.id = uniqueId('Range');
  }
  render(): React.ReactNode {
    return (
      <div className="range">
        <input
          id={this.id}
          type="range"
          value={this.props.value}
          min={this.props.min}
          max={this.props.max}
          onChange={this.props.onUpdate}
        />
      </div>
    );
  }
}

const playbackRateInfo = new Map<number, { icon: string }>([
  [1,    { icon: 'images/speed-1x.svg' }],
  [0.66, { icon: 'images/speed-.66x.svg' }],
  [0.5,  { icon: 'images/speed-.5x.svg' }],
  [0.33, { icon: 'images/speed-.33x.svg' }],
  [0.25, { icon: 'images/speed-.25x.svg' }],
  [3,    { icon: 'images/speed-3x.svg' }],
  [2,    { icon: 'images/speed-2x.svg' }],
  [1.5,  { icon: 'images/speed-1.5x.svg' }],
]);

type QueProps = {
  active: boolean;
  actions: { [key in ActionId]: () => void };
  videoState: VideoState;
  outEventBus: ForwardableEventDispatcher<AppEventMap>;
  anyPlaying: boolean;
};

class Que extends React.Component<QueProps> {
  private _makeButton(actionName: ActionId): React.ReactNode {
    const actionFuncs = this.props.actions;
    const action = actions[actionName];
    return (
      <button type="button" onClick={actionFuncs[actionName]} data-tooltip={action.hint}>
        <img src={action.icon} />
      </button>
    );
  }

  private _changeTime = (event: React.ChangeEvent<HTMLInputElement>): void => {
    this.props.outEventBus.dispatch(
      new TimeUpdateEvent(
        Number(event.target.value) / Number(event.target.max) * this.props.videoState.duration,
      ),
    );
  };

  private _changeVolume = (event: React.ChangeEvent<HTMLInputElement>): void => {
    // Dispatch volumeChange event — Viewer handles it and updates video.volume + state.
    this.props.outEventBus.dispatch(
      new ForwardableEvent('volumeChange'),
      Number(event.target.value) / Number(event.target.max),
    );
  };

  render(): React.ReactNode {
    const { videoState, actions: actionFuncs, anyPlaying } = this.props;
    const { cyclePlaybackSpeed: cyclePlaybackSpeedAction } = actions;
    const videoClasses = new CSSArray('video-controls');
    videoClasses.addIf(!this.props.active, 'disabled');
    return (
      <div className={videoClasses.toString()}>
        {/* this._makeButton('fastBackward') */}
        <button type="button" onClick={actionFuncs.playAll} data-tooltip={actions.playAll.hint}>
          <img src={anyPlaying ? 'images/buttons/pause-all.svg' : 'images/buttons/play-all.svg'} />
        </button>
        <button type="button" onClick={actionFuncs.togglePlay} data-tooltip={actions.togglePlay.hint}>
          <img src={videoState.playing ? 'images/buttons/pause.svg' : 'images/buttons/play.svg'} />
        </button>
        <div className="cue">
          <Range
            value={videoState.time / videoState.duration * 10000}
            min="0"
            max="10000"
            onUpdate={this._changeTime}
          />
        </div>
        <button
          type="button"
          onClick={actionFuncs.cyclePlaybackSpeed}
          data-tooltip={cyclePlaybackSpeedAction.hint}
        >
          <img src={playbackRateInfo.get(videoState.playbackRate)?.icon ?? ''} />
        </button>
        {this._makeButton('fastBackward')}
        {this._makeButton('fastForward')}
        {this._makeButton('setLoop')}
        <div className="volume tooltip-high" data-tooltip="volume">
          <Range
            value={videoState.volume * 1000}
            min="0"
            max="1000"
            onUpdate={this._changeVolume}
          />
        </div>
        {/* this._makeButton('fastForward') */}
      </div>
    );
  }
}

let viewId = 0;

const DEFAULT_VIEWER_STATE: ViewerState = {
  zoom: 1,
  mimeType: '',
  viewing: false,
  videoState: {
    playing: false,
    time: 0,
    duration: 1,
    playbackRate: 1,
    volume: 1,
    currentUrl: '',
    loop: 0,
    loopStart: 0,
    loopEnd: 1,
  },
};

type Props = {
  actions: { [key in ActionId]: () => void };
  outEventBus: ForwardableEventDispatcher<AppEventMap>;
  // Receives live viewerState updates via 'viewerStateChanged' events from the active Viewer.
  inEventBus: ForwardableEventDispatcher<AppEventMap>;
  anyPlaying: boolean;
};

type State = {
  viewerState: ViewerState;
};

export default class ViewerToolbar extends React.Component<Props, State> {
  private _logger: ReturnType<typeof debug>;
  private _viewId: number;

  constructor(props: Props) {
    super(props);
    this._logger = debug('ViewerToolBar');
    this._viewId = ++viewId;
    this.state = { viewerState: DEFAULT_VIEWER_STATE };
  }

  componentDidMount(): void {
    this.props.inEventBus.on('viewerStateChanged', this._handleViewerStateChanged);
  }

  componentWillUnmount(): void {
    this.props.inEventBus.removeListener('viewerStateChanged', this._handleViewerStateChanged);
  }

  private _handleViewerStateChanged = (_event: unknown, viewerState: ViewerState): void => {
    this.setState({ viewerState });
  };

  private _changeZoom = (e: React.ChangeEvent<HTMLInputElement>): void => {
    // Dispatch setZoom event — Viewer listens and updates its own state.
    this.props.outEventBus.dispatch(
      new ForwardableEvent('setZoom'),
      Number(e.target.value) / 100,
    );
  };

  private _makeButton(actionName: ActionId): React.ReactNode {
    const actionFuncs = this.props.actions;
    const action = actions[actionName];
    return (
      <button type="button" onClick={actionFuncs[actionName]} data-tooltip={action.hint}>
        <img src={action.icon} />
      </button>
    );
  }

  render(): React.ReactNode {
    this._logger('render');
    const { viewerState } = this.state;
    const isVideo = filters.isMimeVideo(viewerState.mimeType) || filters.isAudioExtension(viewerState.mimeType);
    document.title = `view: ${this._viewId}`;
    return (
      <div className="toolbar viewertoolbar">
        <div className="button-group">
          {this._makeButton('gotoPrev')}
          {this._makeButton('gotoNext')}
          {this._makeButton('closeViewer')}
          {this._makeButton('rotate')}
          {this._makeButton('changeStretchMode')}
        </div>
        <div className="zoom tooltip-high" data-tooltip="zoom">
          <Range
            value={viewerState.zoom * 100}
            min={50}
            max={400}
            onUpdate={this._changeZoom}
          />
        </div>
        <Que
          active={isVideo}
          actions={this.props.actions}
          videoState={viewerState.videoState}
          outEventBus={this.props.outEventBus}
          anyPlaying={this.props.anyPlaying}
        />
        <div className="button-group">
          {this._makeButton('toggleSlideshow')}
          {this._makeButton('splitVertical')}
          {this._makeButton('splitHorizontal')}
          {this._makeButton('deletePane')}
          {this._makeButton('showHelp')}
        </div>
      </div>
    );
  }
}
