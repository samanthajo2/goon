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
import {observable, action} from 'mobx';
import {observer} from 'mobx-react';
import ActionEvent from '../../lib/action-event';
import bind from '../../lib/bind';
import debug from '../../lib/debug';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher';
import ListenerManager from '../../lib/listener-manager';
import MediaManagerClient from '../../lib/media-manager-client';
import ForwardableEvent from '../../lib/forwardable-event';
import ImageGrids from './image-grids';
import Viewer from './viewer';
import {CSSArray} from '../../lib/css-utils';
import {euclideanModulo} from '../../lib/utils';

let g_vpairCount = 0;

@observer
export default class VPair extends React.Component {
  constructor(props) {
    super(props);
    this._logger = debug('VPair', ++g_vpairCount);
    this._logger('ctor');
    this._downstreamEventBus = new ForwardableEventDispatcher();
    this._downstreamEventBus.debugId = `${this._logger.getPrefix()}-downstream`;
    this._eventBus = new ForwardableEventDispatcher();
    this._eventBus.debugId = this._logger.getPrefix();
    this._mediaManager = new MediaManagerClient();
    bind(
      this,
      '_close',
      '_gotoNext',
      '_gotoPrev',
      '_gotoImage',
      '_setCurrentNdx',
      '_handleClick',
      '_setCurrentView',
      '_handleActions',
      '_viewCurrentIndex',
      '_saveScrollTop',
      '_splitUp',
      '_splitDown',
      '_splitLeft',
      '_splitRight',
      '_startViewingImage',
      '_stopViewingImage',
    );

    const {initialState: initialStates = {}} = props;
    const {
      viewerState: initialViewerState = {},
      imagegridState: initialImagegridState = {},
      state: initialState = {},
    } = initialStates;
    const {videoState: initialVideoState = {}} = initialViewerState;

    const videoState = observable({
      ...{
        playing: false,
        time: 0,
        duration: 1,
        playbackRate: 1,
        volume: 1,
        loop: 0,   // 0 no loop, 1 = start set, 2 = start and end set (looping)
        loopStart: 0,
        loopEnd: 1,
        currentUrl: '',
      },
      ...initialVideoState,
    });

    this._viewerState = observable.object({
      ...{
        viewing: false,
        mimeType: 'image',  // mimeType image, video
        filename: '',
        fileInfo: {},
        duration: 1,
        rotation: 0,
        stretchMode: 'constrain',
        zoom: 1,
        slideshow: false,
      },
      ...initialViewerState,
      ...{
        videoState,
      }
    }, {}, {deep: false});

    const imageGridState = {
      ...{
        currentCollection: undefined,
      },
      ...initialImagegridState,
    };

    this._imagegridState = observable.object(imageGridState, {}, {deep: false});

    this.state = {
      ...{
        currentImageIndex: -1,
        gotoFolderNdx: -1,
      },
      ...initialState,
    };
    // should this be state? I don't want it to re-render!
    this._imagegridsScrollTop = 0;

    this._viewing = false;
    this.props.setCurrentView(this);
    this._listenerManager = new ListenerManager();
    const on = this._listenerManager.on.bind(this._listenerManager);
    const eventBus = this._eventBus;
    on(eventBus, 'action', this._handleActions);
    on(eventBus, 'setCurrentNdx', this._setCurrentNdx);
    on(eventBus, 'gotoNext', this._gotoNext);
    on(eventBus, 'gotoPrev', this._gotoPrev);
    on(eventBus, 'view', this._startViewingImage);
    on(eventBus, 'hide', this._stopViewingImage);
    on(eventBus, 'goToImage', this._gotoImage);
  }
  componentDidMount() {
    this.props.registerVPair(this);
  }
  componentWillUnmount() {
    this.props.unregisterVPair(this);
    this._mediaManager.close();
    this._listenerManager.removeAll();
  }
  // this is used so when we split a view the view can start in the same place
  // as the split view.
  getState() {
    return {
      viewerState: {
        ...this._viewerState,
        videoState: {...this._viewerState.videoState},
      },
      imagegridState: {
        ...this._imagegridState,
      },
      state: {
        ...this.state,
      },
    };
  }
  // this is used by the toolbar. I need a mobx reactive object to tweak so changes
  // to the toolbar affect this view.
  getViewerState() {
    return this._viewerState;
  }
  // this is used by the toolbar. I need a mobx reactive object to tweak so changes
  // to the toolbar affect this view.
  getImagegridState() {
    return this._imagegridState;
  }
  getDownstreamEventBus() {
    return this._downstreamEventBus;
  }
  getEventBus() {
    return this._eventBus;
  }
  @action _startViewingImage(event, fileInfo) {
    this._viewerState.viewing = true;
    this._viewerState.fileInfo = fileInfo;
    this._viewerState.mimeType = fileInfo.type;
  }
  @action _stopViewingImage() {
    this._viewerState.viewing = false;
  }
  _setCurrentNdx(forwardableEvent, ndx) {
    this._logger('setCurrentImage:', ndx);
    this.setState({
      currentImageIndex: ndx,
    });
  }
  _close(e) {
    e.stopPropagation();
    this.props.setCurrentView(this);
    this._eventBus.dispatch(new ActionEvent({action: 'deletePane'}));
  }
  _splitLeft() {
    this.props.setCurrentView(this);
    this._eventBus.dispatch(new ActionEvent({action: 'splitVerticalAlt'}));
  }
  _splitRight() {
    this.props.setCurrentView(this);
    this._eventBus.dispatch(new ActionEvent({action: 'splitVertical'}));
  }
  _splitUp() {
    this.props.setCurrentView(this);
    this._eventBus.dispatch(new ActionEvent({action: 'splitHorizontalAlt'}));
  }
  _splitDown() {
    this.props.setCurrentView(this);
    this._eventBus.dispatch(new ActionEvent({action: 'splitHorizontal'}));
  }
  _gotoImage(event, ndx, folderNdx) {
    this._eventBus.dispatch(new ForwardableEvent('hide'));
    // This is a CRAP!
    // The issue is the user is using the VIEWER
    // this message means (close the viewer, open the imagegrids, set it to a certain folder)
    // Since if the user is using the viewer the ImageGrids does not exist yet
    // the message we're dispatching will be lost. Hacky solution is
    // to pass the folder we want so when the ImageGrids is instanciated
    // it can start at the folder. On the other hand, once it's started
    // we don't want to base it off state since the user should be able
    // to freely scroll. Maybe a different solution would be able compute
    // the scroll position but we don't know the scroll position since it's
    // the imagegrids that computes that info.
    // See _saveScrollTop below for rest of hack
    this.setState({
      gotoFolderNdx: folderNdx,
    });
    this._eventBus.dispatch(new ForwardableEvent('scrollToImage'), ndx, folderNdx);
  }
  _viewImage(imgNdx) {
    let ndx = imgNdx;
    this._logger('viewImage: ', ndx);
    const folders = this.props.root.folders;
    for (let folderNdx = 0; folderNdx < folders.length; ++folderNdx) {
      const folder = folders[folderNdx];
      if (ndx < folder.files.length) {
        this._eventBus.dispatch(new ForwardableEvent('view'), folder.files[ndx].info);
        return;
      }
      ndx -= folder.files.length;
    }
    throw new Error('image index out of range');
  }
  _viewCurrentIndex() {
    this._viewImage(this.state.currentImageIndex);
  }
  _gotoNext() {
    const root = this.props.root;
    this.setState((prevState) => ({
      currentImageIndex: (prevState.currentImageIndex + 1) % root.totalFiles,
    }), this._viewCurrentIndex);
  }
  _gotoPrev() {
    const root = this.props.root;
    this.setState((prevState) => ({
      currentImageIndex: euclideanModulo(prevState.currentImageIndex - 1, root.totalFiles),
    }), this._viewCurrentIndex);
  }
  _setCurrentView() {
    this._logger('setCurrentView');
    this.props.setCurrentView(this);
  }
  _handleClick() {
    this._setCurrentView();
  }
  _handleActions(...args) {
    this.props.actionListener.routeAction(...args);
  }
  _saveScrollTop(scrollTop) {
    this._imagegridsScrollTop = scrollTop;
    // This is a hack! See _gotoImage above
    if (this.state.gotoFolderNdx >=  0) {
      this.setState({
        gotoFolderNdx: -1,
      });
    }
  }
  render() {
    const classes = new CSSArray('vpair');
    classes.addIf(this.props.isCurrentView, 'active');
    return (
      <div className={classes} onClick={this._handleClick}>
        { this._viewerState.viewing ? (
          <Viewer
            options={this.props.options}
            eventBus={this._eventBus}
            downstreamEventBus={this._downstreamEventBus}
            viewerState={this._viewerState}
            prefs={this.props.prefs}
            mediaManager={this._mediaManager}
            setCurrentView={this._setCurrentView}
            rotateMode={this.props.rotateMode}
          />
        ) : (
          <ImageGrids
            gotoFolderNdx={this.state.gotoFolderNdx}
            scrollTop={this._imagegridsScrollTop}
            saveScrollTop={this._saveScrollTop}
            root={this.props.root}
            options={this.props.options}
            prefs={this.props.prefs}
            settings={this.props.settings}
            winState={this.props.winState}
            imagegridState={this._imagegridState}
            eventBus={this._eventBus}
            rotateMode={this.props.rotateMode}
            gridMode={this.props.gridMode}
            setCurrentView={this._setCurrentView}
            currentImageIndex={this.state.currentImageIndex}
          />
        )}
        <div className="close-vpair" onClick={this._close}>❎</div>
        <div className="vpair-split-up" onClick={this._splitUp}>⬆</div>
        <div className="vpair-split-down" onClick={this._splitDown}>⬇</div>
        <div className="vpair-split-left" onClick={this._splitLeft}>⬅</div>
        <div className="vpair-split-right" onClick={this._splitRight}>➡</div>
        <div className="tick">◤</div>
        <div className="spacer"></div>
      </div>
    );
  }
}
