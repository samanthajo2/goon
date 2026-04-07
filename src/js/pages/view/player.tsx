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
import { action } from 'mobx';
import { observer } from 'mobx-react';
import ActionEvent from '../../lib/action-event';
import { TimeUpdateEvent, VideoState } from './viewer-events';
import { AppContext } from './contexts';

const _pauseIcon = '❚❚';
const _playIcon = '▶';
const _padZero = (num: number, size: number): string => num.toString().padStart(size, '0');

type Props = {
  videoState: VideoState;
};

@observer
export default class Player extends React.Component<Props> {
  static contextType = AppContext;
  declare context: React.ContextType<typeof AppContext>;

  private _changeTime = (event: React.ChangeEvent<HTMLInputElement>): void => {
    this.context.eventBus.dispatch(
      new TimeUpdateEvent(Number(event.target.value) / Number(event.target.max) * this.props.videoState.duration),
    );
  };

  private _togglePlay = (): void => {
    this.context.eventBus.dispatch(new ActionEvent({ action: 'togglePlay' }));
  };

  @action private _changeVolume = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.props.videoState.volume = Number(e.target.value) / 10000;
  };

  private _getTime(): string {
    const totalSeconds = this.props.videoState.time | 0;
    const s = totalSeconds % 60;
    const m = (totalSeconds / 60 | 0) % 60;
    const h = totalSeconds / 60 / 60 | 0;
    return `${h === 0 ? '' : `${_padZero(h, 2)}:`}${_padZero(m, 2)}:${_padZero(s, 2)}`;
  }

  render(): React.ReactNode {
    const { videoState } = this.props;
    return (
      <div className="player">
        <div className="play" onClick={this._togglePlay}>{videoState.playing ? _pauseIcon : _playIcon}</div>
        <input
          className="que"
          onChange={this._changeTime}
          type="range"
          min="0"
          max="10000"
          value={videoState.time / videoState.duration * 10000}
        />
        <div className="time">{this._getTime()}</div>
        <div className="vol">
          <input
            onChange={this._changeVolume}
            className="volume"
            type="range"
            min="0"
            max="10000"
            value={videoState.volume * 10000}
          />
        </div>
      </div>
    );
  }
}
