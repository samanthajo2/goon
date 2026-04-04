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
import { observable, action } from 'mobx';
import { observer } from 'mobx-react';
import ActionEvent from '../../lib/action-event';
import debug from '../../lib/debug';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher';
import ListenerManager from '../../lib/listener-manager';
import MediaManagerClient from '../../lib/media-manager-client';
import ForwardableEvent from '../../lib/forwardable-event';
import ImageGrids from './image-grids';
import Viewer from './viewer';
import { CSSArray } from '../../lib/css-utils';
import { euclideanModulo } from '../../lib/utils';
import ActionListener from '../../lib/action-listener';
import { FolderStateRoot } from './folder-state-helper';
import { Preferences } from '../prefs/default-prefs';
import { ScrollAnchor } from './image-grids';
import { VideoState } from './viewer-events';
import { GridMode } from './grid-modes';

let g_vpairCount = 0;

type Options = {
  columnWidth: number;
  padding: number;
  maxSeekTime: number;
};

type WinState = {
  gridMode: GridMode;
  thumbnailZoom: number;
  showUI: number;
  rotateMode: number;
  sortMode: string;
};

// MobX observable shape for the viewer/video state
type ObservableVideoState = VideoState;

type ObservableViewerState = {
  viewing: boolean;
  mimeType: string;
  filename: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fileInfo: any;
  duration: number;
  rotation: number;
  stretchMode: string;
  zoom: number;
  slideshow: boolean;
  videoState: ObservableVideoState;
};

type ObservableImagegridState = {
  currentCollection: unknown;
};

type InitialViewerState = Partial<ObservableViewerState> & {
  videoState?: Partial<ObservableVideoState>;
};

type InitialState = {
  viewerState?: InitialViewerState;
  imagegridState?: Partial<ObservableImagegridState>;
  state?: Partial<ComponentState>;
  scrollTop?: number;
  scrollAnchor?: ScrollAnchor | null;
};

type Props = {
  twoId: string;
  initialState?: InitialState;
  width: number;
  isCurrentView: boolean;
  options: Options;
  prefs: Preferences;
  winState: WinState;
  rotateMode: number;
  eventBus: ForwardableEventDispatcher;
  setCurrentView: (vpair: VPair) => void;
  actionListener: ActionListener;
  registerVPair: (vpair: VPair) => void;
  unregisterVPair: (vpair: VPair) => void;
  saveLayout?: () => void;
  root: FolderStateRoot;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings?: any;
};

type ComponentState = {
  currentImageIndex: number;
  gotoFolderNdx: number;
};

@observer
export default class VPair extends React.Component<Props, ComponentState> {
  private _logger: ReturnType<typeof debug>;
  private _downstreamEventBus: ForwardableEventDispatcher;
  private _eventBus: ForwardableEventDispatcher;
  private _mediaManager: MediaManagerClient;
  private _viewerState: ObservableViewerState;
  private _imagegridState: ObservableImagegridState;
  private _imagegridsScrollTop: number;
  private _imagegridsAnchor: ScrollAnchor | null;
  private _listenerManager: ListenerManager;

  constructor(props: Props) {
    super(props);
    this._logger = debug('VPair', ++g_vpairCount);
    this._logger('ctor');
    this._downstreamEventBus = new ForwardableEventDispatcher();
    this._downstreamEventBus.debugId = `${this._logger.getPrefix()}-downstream`;
    this._eventBus = new ForwardableEventDispatcher();
    this._eventBus.debugId = this._logger.getPrefix();
    this._mediaManager = new MediaManagerClient();

    const { initialState: initialStates = {} } = props;
    const {
      viewerState: initialViewerState = {},
      imagegridState: initialImagegridState = {},
      state: initialStateValues = {},
      scrollTop: initialScrollTop = 0,
      scrollAnchor: initialScrollAnchor = null,
    } = initialStates;
    const { videoState: initialVideoState = {} } = initialViewerState;

    const videoState: ObservableVideoState = observable({
      playing: false,
      time: 0,
      duration: 1,
      playbackRate: 1,
      volume: 1,
      loop: 0,
      loopStart: 0,
      loopEnd: 1,
      currentUrl: '',
      ...initialVideoState,
    });

    this._viewerState = observable.object({
      viewing: false,
      mimeType: 'image',
      filename: '',
      fileInfo: {},
      duration: 1,
      rotation: 0,
      stretchMode: 'constrain',
      zoom: 1,
      slideshow: false,
      ...initialViewerState,
      videoState,
    } as ObservableViewerState, {}, { deep: false });

    this._imagegridState = observable.object({
      currentCollection: undefined,
      ...initialImagegridState,
    } as ObservableImagegridState, {}, { deep: false });

    this.state = {
      currentImageIndex: -1,
      gotoFolderNdx: -1,
      ...initialStateValues,
    };

    this._imagegridsScrollTop = initialScrollTop;
    this._imagegridsAnchor = initialScrollAnchor;

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

  componentDidMount(): void {
    this.props.registerVPair(this);
  }

  componentWillUnmount(): void {
    this.props.unregisterVPair(this);
    this._mediaManager.close();
    this._listenerManager.removeAll();
  }

  getState(): InitialState {
    return {
      viewerState: {
        ...this._viewerState,
        videoState: { ...this._viewerState.videoState },
      },
      imagegridState: {
        ...this._imagegridState,
      },
      state: {
        ...this.state,
      },
      scrollTop: this._imagegridsScrollTop,
      scrollAnchor: this._imagegridsAnchor,
    };
  }

  getViewerState(): ObservableViewerState {
    return this._viewerState;
  }

  getImagegridState(): ObservableImagegridState {
    return this._imagegridState;
  }

  getDownstreamEventBus(): ForwardableEventDispatcher {
    return this._downstreamEventBus;
  }

  getEventBus(): ForwardableEventDispatcher {
    return this._eventBus;
  }

  @action private _startViewingImage = (_event: ForwardableEvent, fileInfo: { type: string; filename?: string }): void => {
    this._viewerState.viewing = true;
    this._viewerState.fileInfo = fileInfo;
    this._viewerState.mimeType = fileInfo.type;
  };

  @action private _stopViewingImage = (): void => {
    this._viewerState.viewing = false;
  };

  private _setCurrentNdx = (_forwardableEvent: ForwardableEvent, ndx: number): void => {
    this._logger('setCurrentImage:', ndx);
    this.setState({
      currentImageIndex: ndx,
    });
  };

  private _close = (e: React.MouseEvent): void => {
    e.stopPropagation();
    this.props.setCurrentView(this);
    this._eventBus.dispatch(new ActionEvent({ action: 'deletePane' }));
  };

  private _splitLeft = (): void => {
    this.props.setCurrentView(this);
    this._eventBus.dispatch(new ActionEvent({ action: 'splitVerticalAlt' }));
  };

  private _splitRight = (): void => {
    this.props.setCurrentView(this);
    this._eventBus.dispatch(new ActionEvent({ action: 'splitVertical' }));
  };

  private _splitUp = (): void => {
    this.props.setCurrentView(this);
    this._eventBus.dispatch(new ActionEvent({ action: 'splitHorizontalAlt' }));
  };

  private _splitDown = (): void => {
    this.props.setCurrentView(this);
    this._eventBus.dispatch(new ActionEvent({ action: 'splitHorizontal' }));
  };

  private _gotoImage = (_event: ForwardableEvent, ndx: number, folderNdx: number): void => {
    this._eventBus.dispatch(new ForwardableEvent('hide'));
    this.setState({
      gotoFolderNdx: folderNdx,
    });
    this._eventBus.dispatch(new ForwardableEvent('scrollToImage'), ndx, folderNdx);
  };

  private _viewImage(imgNdx: number): void {
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

  private _viewCurrentIndex = (): void => {
    this._viewImage(this.state.currentImageIndex);
  };

  private _gotoNext = (): void => {
    const root = this.props.root;
    this.setState((prevState) => ({
      currentImageIndex: (prevState.currentImageIndex + 1) % root.totalFiles,
    }), this._viewCurrentIndex);
  };

  private _gotoPrev = (): void => {
    const root = this.props.root;
    this.setState((prevState) => ({
      currentImageIndex: euclideanModulo(prevState.currentImageIndex - 1, root.totalFiles),
    }), this._viewCurrentIndex);
  };

  private _setCurrentView = (): void => {
    this._logger('setCurrentView');
    this.props.setCurrentView(this);
  };

  private _handleClick = (): void => {
    this._setCurrentView();
  };

  private _handleActions = (event: import('../../lib/action-event').default, ...args: unknown[]): void => {
    this.props.actionListener.routeAction(event, ...args);
  };

  private _saveScrollTop = (scrollTop: number, anchor: ScrollAnchor | null): void => {
    this._imagegridsScrollTop = scrollTop;
    this._imagegridsAnchor = anchor || null;
    if (this.state.gotoFolderNdx >= 0) {
      this.setState({
        gotoFolderNdx: -1,
      });
    }
    if (this.props.saveLayout) {
      this.props.saveLayout();
    }
  };

  render(): React.ReactNode {
    const classes = new CSSArray('vpair');
    classes.addIf(this.props.isCurrentView, 'active');
    return (
      <div className={classes.toString()} onClick={this._handleClick}>
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
            initialAnchor={this._imagegridsAnchor}
            saveScrollTop={this._saveScrollTop}
            root={this.props.root}
            width={this.props.width}
            options={this.props.options}
            prefs={this.props.prefs}
            winState={this.props.winState}
            imagegridState={this._imagegridState}
            eventBus={this._eventBus}
            rotateMode={this.props.rotateMode}
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
