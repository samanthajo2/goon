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
import {action} from 'mobx';
import {observer} from 'mobx-react';
import bind from '../../lib/bind';
import ActionEvent from '../../lib/action-event';
import {TimeUpdateEvent} from './viewer-events';

const _pauseIcon = '❚❚';
const _playIcon = '▶';
const _padZero = (num, size) => num.toString().padStart(size, '0');

@observer
export default class Player extends React.Component {
  constructor(props) {
    super(props);
    bind(
      this,
      '_changeTime',
      '_changeVolume',
      '_togglePlay',
    );
  }
  _changeTime(event) {
    this.props.eventBus.dispatch(new TimeUpdateEvent(event.target.value / event.target.max * this.props.videoState.duration));
  }
  _togglePlay() {
    this.props.eventBus.dispatch(new ActionEvent({action: 'togglePlay'}));
  }
  @action _changeVolume(e) {
    this.props.videoState.volume = e.target.value / 10000;
  }
  _getTime() {
    const totalSeconds = this.props.videoState.time | 0;
    const s = totalSeconds % 60;
    const m = (totalSeconds / 60 | 0) % 60;
    const h = totalSeconds / 60 / 60 | 0;

    return `${((h === 0) ? '' : `${_padZero(h, 2)}:`)}${_padZero(m, 2)}:${_padZero(s, 2)}`;
  }
  render() {
    const videoState = this.props.videoState;
    return (
      <div className="player">
        <div className="play" onClick={this._togglePlay}>{videoState.playing ? _pauseIcon : _playIcon}</div>
        <input className="que" onChange={this._changeTime} type="range" min="0" max="10000" value={videoState.time / videoState.duration * 10000} />
        <div className="time">{this._getTime()}</div>
        <div className="vol"><input onChange={this._changeVolume} className="volume" type="range" min="0" max="10000" value={videoState.volume * 10000} /></div>
      </div>
    );
  }
}
