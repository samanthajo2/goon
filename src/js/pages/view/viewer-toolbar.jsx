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

import React from 'react';
import _ from 'lodash';
import {action} from 'mobx';
import {observer} from 'mobx-react';
import bind from '../../lib/bind';
import debug from '../../lib/debug';
import {actions} from '../../lib/actions';
import * as filters from '../../lib/filters';
import {TimeUpdateEvent} from './viewer-events';
import {CSSArray} from '../../lib/css-utils';

class Range extends React.Component {
  constructor(props) {
    super(props);
    this.id = _.uniqueId('Range');
  }
  render() {
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

const playbackRateInfo = new Map([
  [1,    {icon: 'images/speed-1x.svg'}],
  [0.66, {icon: 'images/speed-.66x.svg'}],
  [0.5,  {icon: 'images/speed-.5x.svg'}],
  [0.33, {icon: 'images/speed-.33x.svg'}],
  [0.25, {icon: 'images/speed-.25x.svg'}],
  [3,    {icon: 'images/speed-3x.svg'}],
  [2,    {icon: 'images/speed-2x.svg'}],
  [1.5,  {icon: 'images/speed-1.5x.svg'}],
]);

@observer
class Que extends React.Component {
  constructor(props) {
    super(props);
    bind(
      this,
      '_changeTime',
      '_changeVolume'
    );
  }
  _makeButton(actionName) {
    const actionFuncs = this.props.actions;
    const action = actions[actionName];
    return (
      <button type="button" onClick={actionFuncs[actionName]} data-tooltip={action.hint}><img src={action.icon} /></button>
    );
  }
  _changeTime(event) {
    this.props.outEventBus.dispatch(new TimeUpdateEvent(event.target.value / event.target.max * this.props.videoState.duration));
  }
  @action _changeVolume(event) {
    this.props.videoState.volume = event.target.value / event.target.max;
  }
  render() {
    const {videoState, actions: actionFuncs} = this.props;
    const {cyclePlaybackSpeed: cyclePlaybackSpeedAction} = actions;
    const videoClasses = new CSSArray('video-controls');
    videoClasses.addIf(!this.props.active, 'disabled');
    return (
      <div className={videoClasses}>
        {/* this._makeButton('fastBackward') */}
        <button type="button" onClick={actionFuncs.togglePlay} data-tooltip={actions.togglePlay.hint}><img src={videoState.playing ? 'images/buttons/pause.svg' : 'images/buttons/play.svg'} /></button>
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
          <img src={playbackRateInfo.get(videoState.playbackRate).icon} />
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

@observer
export default class ViewerToolbar extends React.Component {
  constructor(props) {
    super(props);
    this._logger = debug('ViewerToolBar');
    this._viewId = ++viewId;
    bind(
      this,
      '_changeZoom',
    );
  }
  @action _changeZoom(e) {
    this._getViewerState().zoom = e.target.value / 100;
  }
  _getViewerState() {
    return this.props.viewerStateHolder.state || {  // FIX THIS!
      zoom: 1,
      mimeType: '',
      time: 0,
      videoState: {
        playing: false,
        time: 0,
        duration: 1,
        playbackRate: 1,
        volume: 1,
        loop: 0,
        loopStart: 0,
        loopEnd: 1,
      },
    };
  }
  _makeButton(actionName) {
    const actionFuncs = this.props.actions;
    const action = actions[actionName];
    return (
      <button type="button" onClick={actionFuncs[actionName]} data-tooltip={action.hint}><img src={action.icon} /></button>
    );
  }
  render() {
    this._logger('render');
    const viewerState = this._getViewerState();
    const isVideo = filters.isMimeVideo(viewerState.mimeType) || filters.isAudioExtension(viewerState.mimeType);
    // document.title = `view: ${path.basename(viewerState.filename)}`;
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
