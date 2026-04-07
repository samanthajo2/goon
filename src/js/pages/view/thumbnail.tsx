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
import { ipcRenderer } from 'electron';   
import ForwardableEvent from '../../lib/forwardable-event';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher';
import gridModes, { ThumbnailProps } from './grid-modes';
import type { AppEventMap } from './app-event-map';

type Props = ThumbnailProps & {
  count: number;
  eventBus: ForwardableEventDispatcher<AppEventMap>;
  setCurrentView: () => void;
};

export default class Thumbnail extends React.PureComponent<Props> {
  private _viewImage = (): void => {
    this.props.setCurrentView();
    this.props.eventBus.dispatch(new ForwardableEvent('setCurrentNdx'), this.props.count);
    this.props.eventBus.dispatch(new ForwardableEvent('view'), this.props.info);
  };

  private _handleContextMenu = (event: MouseEvent | React.MouseEvent): void => {
    const domEvent = (event instanceof MouseEvent) ? event : event.nativeEvent;
    this.props.eventBus.dispatch(new ForwardableEvent('fileContextMenu', domEvent), this.props.info);
  };

  private _handleDragStart = (event: DragEvent | React.DragEvent): void => {
    const domEvent = (event instanceof DragEvent) ? event : event.nativeEvent;
    domEvent.preventDefault();
    ipcRenderer.send('dragStart', this.props.info.filename);
  };

  render(): React.ReactNode {
    return gridModes.value(this.props.gridMode).render(this.props, this._viewImage, this._handleContextMenu, this._handleDragStart);
  }
}
