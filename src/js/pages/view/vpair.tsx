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
import ActionEvent from '../../lib/action-event.js';
import debug from '../../lib/debug.js';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher.js';
import type { AppEventMap } from './app-event-map.js';
import ListenerManager from '../../lib/listener-manager.js';
import MediaManagerClient from '../../lib/media-manager-client.js';
import ForwardableEvent from '../../lib/forwardable-event.js';
import ImageGrids from './image-grids.js';
import Viewer from './viewer.js';
import { CSSArray } from '../../lib/css-utils.js';
import { euclideanModulo } from '../../lib/utils.js';
import ActionListener from '../../lib/action-listener.js';
import { FolderStateRoot } from './folder-state-helper.js';
import { AppContext } from './contexts.js';
import { ScrollAnchor } from './image-grids.js';
import { VideoState, ImagegridState } from './viewer-events.js';
import { GridMode } from './grid-modes.js';

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

// Plain object shape for viewer state — mutated in-place by Viewer; Viewer calls forceUpdate() after mutations.
type ViewerStateShape = {
  viewing: boolean;
  mimeType: string;
  filename?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fileInfo: any;
  duration: number;
  rotation: number;
  stretchMode: string;
  zoom: number;
  slideshow: boolean;
  videoState: VideoState;
};

type InitialViewerState = Partial<ViewerStateShape> & {
  videoState?: Partial<VideoState>;
};

type InitialState = {
  viewerState?: InitialViewerState;
  imagegridState?: Partial<ImagegridState>;
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
  winState: WinState;
  rotateMode: number;
  setCurrentView: (vpair: VPair) => void;
  actionListener: ActionListener;
  registerVPair: (vpair: VPair) => void;
  unregisterVPair: (vpair: VPair) => void;
  saveLayout?: () => void;
  root: FolderStateRoot;
  // Called when the active pane starts or stops viewing an image.
  // Only fires when this pane is the current view (isCurrentView === true).
  onViewingChanged?: (viewing: boolean) => void;
};

type ComponentState = {
  currentImageIndex: number;
  gotoFolderNdx: number;
  // Mirrors _viewerState.viewing; drives the Viewer ↔ ImageGrids switch in render.
  // Kept in React state so setState() triggers a re-render when viewing changes.
  viewing: boolean;
};

export default class VPair extends React.Component<Props, ComponentState> {
  static contextType = AppContext;
  declare context: React.ContextType<typeof AppContext>;

  private _logger: ReturnType<typeof debug>;
  private _downstreamEventBus: ForwardableEventDispatcher;
  private _eventBus: ForwardableEventDispatcher<AppEventMap>;
  // Cached context value so the Provider reference is stable across renders
  // when neither eventBus nor prefs has changed, avoiding spurious re-renders.
  private _cachedContextPrefs: React.ContextType<typeof AppContext>['prefs'] | null = null;
  private _cachedContextValue: React.ContextType<typeof AppContext> | null = null;
  private _mediaManager: MediaManagerClient;
  // Plain object mutated in-place by Viewer. VPair reads it via getViewerState() for App/ViewSplit queries.
  private _viewerState: ViewerStateShape;
  private _imagegridState: ImagegridState;
  private _imagegridsScrollTop: number;
  private _imagegridsAnchor: ScrollAnchor | null;
  private _listenerManager: ListenerManager;

  // React 19 doesn't pre-set `this.context` before the constructor body runs;
  // it does, however, pass the context value as the second constructor arg
  // when `static contextType` is configured. Read platform from there.
  constructor(props: Props, context: React.ContextType<typeof AppContext>) {
    super(props, context);
    this._logger = debug('VPair', ++g_vpairCount);
    this._logger('ctor');
    this._downstreamEventBus = new ForwardableEventDispatcher();
    this._downstreamEventBus.debugId = `${this._logger.getPrefix()}-downstream`;
    this._eventBus = new ForwardableEventDispatcher();
    this._eventBus.debugId = this._logger.getPrefix();
    this._mediaManager = new MediaManagerClient(context.platform);

    const { initialState: initialStates = {} } = props;
    const {
      viewerState: initialViewerState = {},
      imagegridState: initialImagegridState = {},
      state: initialStateValues = {},
      scrollTop: initialScrollTop = 0,
      scrollAnchor: initialScrollAnchor = null,
    } = initialStates;
    const { videoState: initialVideoState = {} } = initialViewerState;

    const videoState: VideoState = {
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
    };

    this._viewerState = {
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
    };

    this._imagegridState = {
      ...initialImagegridState,
    } as ImagegridState;

    this.state = {
      currentImageIndex: -1,
      gotoFolderNdx: -1,
      viewing: this._viewerState.viewing,
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

  getViewerState(): ViewerStateShape {
    return this._viewerState;
  }

  getImagegridState(): ImagegridState {
    return this._imagegridState;
  }

  getDownstreamEventBus(): ForwardableEventDispatcher {
    return this._downstreamEventBus;
  }

  getEventBus(): ForwardableEventDispatcher {
    return this._eventBus;
  }

  // Dispatch the current viewerState snapshot to the toolbar event bus so that
  // ViewerToolbar initialises correctly when this pane becomes the active view.
  // Called by ViewSplit._setCurrentVPairAndTwo after connecting the downstream bus.
  notifyToolbarOfCurrentState(): void {
    if (this._viewerState.viewing) {
      // Viewer will dispatch 'viewerStateChanged' on mount via componentDidMount.
      // If Viewer is already mounted (pane was already viewing), trigger it explicitly.
      this._downstreamEventBus.dispatch(new ForwardableEvent('viewerStateChanged'), {
        zoom: this._viewerState.zoom,
        mimeType: this._viewerState.mimeType,
        viewing: this._viewerState.viewing,
        filename: this._viewerState.filename,
        videoState: { ...this._viewerState.videoState },
      });
    }
  }

  private _startViewingImage = (_event: ForwardableEvent, fileInfo: { type: string; filename?: string }): void => {
    this._viewerState.viewing = true;
    this._viewerState.fileInfo = fileInfo;
    this._viewerState.mimeType = fileInfo.type;
    // setState drives the Viewer ↔ ImageGrids switch in render.
    this.setState({ viewing: true });
    // Notify App so it can switch toolbar (ViewerToolbar ↔ ImagegridsToolbar).
    // Only called for the active pane; inactive panes should not change the toolbar.
    if (this.props.isCurrentView) {
      this.props.onViewingChanged?.(true);
    }
    // Persist the viewer-open state so quitting now and restarting restores
    // it. Without this the saved layout lags behind viewer open/close.
    this.props.saveLayout?.();
  };

  private _stopViewingImage = (): void => {
    this._viewerState.viewing = false;
    this.setState({ viewing: false });
    if (this.props.isCurrentView) {
      this.props.onViewingChanged?.(false);
    }
    this.props.saveLayout?.();
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

  private _handleActions = (event: import('../../lib/action-event.js').default, ...args: unknown[]): void => {
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
    // Re-provide AppContext with VPair's own eventBus so that Viewer, ImageGrids,
    // Player, and Thumbnail automatically route events through this pane.
    // The value object is cached by prefs reference to avoid spurious re-renders.
    if (this._cachedContextPrefs !== this.context.prefs) {
      this._cachedContextPrefs = this.context.prefs;
      this._cachedContextValue = { eventBus: this._eventBus, prefs: this.context.prefs, platform: this.context.platform };
    }

    const classes = new CSSArray('vpair');
    classes.addIf(this.props.isCurrentView, 'active');
    return (
      <AppContext value={this._cachedContextValue!}>
        <div className={classes.toString()} onClick={this._handleClick}>
          { this.state.viewing ? (
            <Viewer
              options={this.props.options}
              downstreamEventBus={this._downstreamEventBus}
              viewerState={this._viewerState}
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
              winState={this.props.winState}
              rotateMode={this.props.rotateMode}
              setCurrentView={this._setCurrentView}
              currentImageIndex={this.state.currentImageIndex}
            />
          )}
          <div className="close-vpair" onClick={this._close}>❎</div>
          {/*
          <div className="vpair-split-up" onClick={this._splitUp}>⬆</div>
          <div className="vpair-split-down" onClick={this._splitDown}>⬇</div>
          <div className="vpair-split-left" onClick={this._splitLeft}>⬅</div>
          <div className="vpair-split-right" onClick={this._splitRight}>➡</div>
          */}
          <div className="tick">◤</div>
          <div className="spacer"></div>
        </div>
      </AppContext>
    );
  }
}
