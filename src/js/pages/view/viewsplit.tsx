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
import { observable, action, IObservableArray } from 'mobx';
import { observer } from 'mobx-react';
import ResizeSensor from '../../lib/ui/resize-sensor';
import _ from 'lodash';
import { ipcRenderer } from 'electron';  // eslint-disable-line
import debug from '../../lib/debug';
import VPair from './vpair';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher';
import ActionEvent from '../../lib/action-event';
import ActionListener from '../../lib/action-listener';
import { getRotatedXY } from '../../lib/rotatehelper';
import { px } from '../../lib/utils';
import { FolderStateRoot } from './folder-state-helper';
import { Preferences } from '../prefs/default-prefs';
import { GridMode } from './grid-modes';

/* global Yoga */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const assert = (condition: unknown, ...msg: any[]): void => console.assert(Boolean(condition), ...msg);
const sliderSize = 5;
const splitMinSize = 10;

const dummyEvent = {
  preventDefault: () => {},
  stopPropagation: () => {},
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function fudge(v: number): number {
  return Math.round(v);
}

type TwoBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type TwoDump = {
  splitType: number;
  sliderPercent: number;
  children: TwoDump[];
  initialState?: unknown;
};

let g_twoCount = 0;

class Two {
  static NONE = 0;
  static HORIZONTAL = 1;
  static VERTICAL = 2;

  static createId(): string {
    return `two-${++g_twoCount}`;
  }

  splitType: number;
  id: string;
  children: Two[];
  parent?: Two;
  sliderPos: number;
  sliderPercent: number;
  bounds: TwoBounds;
  initialState?: unknown;

  constructor(id?: string) {
    this.splitType = Two.NONE;
    this.id = id || Two.createId();
    this.children = [];
    this.sliderPos = 0;
    this.sliderPercent = 0;
    this.bounds = { left: 0, top: 0, width: 1, height: 1 };
  }

  restore(data: TwoDump, twos: Record<string, Two>): Two | null {
    let active: Two | null = null;
    this.splitType = data.splitType;
    this.sliderPercent = data.sliderPercent;
    if (data.initialState !== undefined) {
      this.initialState = data.initialState;
    }
    this.children = data.children.map((child) => {
      const two = new Two();
      twos[two.id] = two;
      const maybe = two.restore(child, twos);
      active = active || maybe;
      two._setParent(this);
      return two;
    });
    return this.children.length ? null : this;
  }

  layout(width: number, height: number): Two[] {
    const config = Yoga.Config.create();
    const twos: Two[] = [];
    const root = this._makeNode(config, twos);
    root.setWidth(width);
    root.setHeight(height);
    root.calculateLayout(Yoga.UNDEFINED, Yoga.UNDEFINED, Yoga.DIRECTION_LTR);
    this._applyLayout(root, 0, 0);
    root.freeRecursive();
    config.free();
    return twos;
  }

  dump(): TwoDump {
    const result: TwoDump = {
      splitType: this.splitType,
      sliderPercent: this.sliderPercent,
      children: this.children.map((child) => child.dump()),
    };
    if (this.initialState !== undefined) {
      result.initialState = this.initialState;
    }
    return result;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _makeNode(config: any, twos: Two[]): any {
    const node = Yoga.Node.create(config);
    node.setFlexGrow(1);
    node.setFlexBasis(1);
    node.setFlexDirection(this.splitType === Two.HORIZONTAL ? Yoga.FLEX_DIRECTION_COLUMN : Yoga.FLEX_DIRECTION_ROW);
    assert(this.children.length === 0 || this.children.length === 2);
    const child0 = this.children[0];
    const child1 = this.children[1];
    if (child0) {
      const childNode = child0._makeNode(config, twos);
      childNode.setFlexGrow(0);
      childNode.setFlexBasis(`${this.sliderPercent * 100}%`);
      node.insertChild(childNode, 0);
    }
    twos.push(this);
    const needSlider = this.splitType !== Two.NONE;
    if (needSlider) {
      assert(child0 && child1);
      const sliderNode = Yoga.Node.create(config);
      sliderNode.setFlexGrow(0);
      sliderNode.setFlexBasis(sliderSize);
      node.insertChild(sliderNode, 1);
    }
    if (child1) {
      node.insertChild(child1._makeNode(config, twos), needSlider ? 2 : 1);
    }
    return node;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _applyLayout(node: any, xOff: number, yOff: number): void {
    const x = xOff + node.getComputedLeft();
    const y = yOff + node.getComputedTop();
    this.bounds.left = x;
    this.bounds.top = y;
    this.bounds.width = node.getComputedWidth();
    this.bounds.height = node.getComputedHeight();
    assert(this.children.length === 0 || this.children.length === 2);
    const child0 = this.children[0];
    const child1 = this.children[1];
    if (child0) {
      child0._applyLayout(node.getChild(0), x, y);
    }
    const needSlider = this.splitType !== Two.NONE;
    if (needSlider) {
      const sliderNode = node.getChild(1);
      const sx = x + sliderNode.getComputedLeft();
      const sy = y + sliderNode.getComputedTop();
      this.sliderPos = this.splitType === Two.HORIZONTAL ? sy : sx;
    }
    if (child1) {
      child1._applyLayout(node.getChild(needSlider ? 2 : 1), x, y);
    }
  }

  private _removeChild(child: Two): void {
    const ndx = this.children.indexOf(child);
    assert(ndx >= 0, 'it is our child');
    this.children.splice(ndx, 1);
  }

  private _addChild(child: Two): void {
    assert(this.children.length < 2, 'less than 2 children');
    this.children.push(child);
  }

  private _setParent(parent: Two | null): void {
    if (this.parent) {
      this.parent._removeChild(this);
    }
    this.parent = parent ?? undefined;
    if (parent) {
      parent._addChild(this);
    }
  }

  getRightMost(): Two {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: Two = this;
    while (current.children.length) {
      current = current.children[current.children.length - 1];
    }
    return current;
  }

  getLeftMost(): Two {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: Two = this;
    while (current.children.length) {
      current = current.children[0];
    }
    return current;
  }

  getPrev(): Two {
    const parent = this.parent;
    if (!parent) {
      return this.getRightMost();
    }
    if (parent.children.length === 2 && parent.children[1] === this) {
      return parent.children[0].getRightMost();
    }
    return parent.getPrev();
  }

  getNext(): Two {
    const parent = this.parent;
    if (!parent) {
      return this.getLeftMost();
    }
    if (parent.children.length === 2 && parent.children[0] === this) {
      return parent.children[1].getLeftMost();
    }
    return parent.getNext();
  }

  split(splitType: number, newSecond: boolean): Two {
    assert(this.splitType === Two.NONE, 'not already split');
    assert(this.children.length === 0, 'we have no children');
    const clone = new Two(this.id);
    this.id = Two.createId();
    this.splitType = splitType;
    this.sliderPercent = .5;
    if (!newSecond) {
      clone._setParent(this);
    }
    const newSibling = new Two();
    newSibling._setParent(this);
    if (newSecond) {
      clone._setParent(this);
    }
    return newSibling;
  }

  delete(): Two {
    assert(this.parent, 'we have a parent');
    assert(this.children.length === 0, 'we have no children');
    const parent = this.parent!;
    this._setParent(null);
    assert(parent.children.length === 1, 'there is one sibling');
    const sibling = parent.children[0];
    parent.id = sibling.id;
    parent.splitType = sibling.splitType;
    parent.sliderPos = sibling.sliderPos;
    parent.sliderPercent = sibling.sliderPercent;
    sibling._setParent(null);
    sibling.children.slice().forEach((child) => {
      child._setParent(parent);
    });
    let node = parent;
    while (node.children.length) {
      node = node.children[0];
    }
    return node;
  }

  slide(dx: number, dy: number): boolean {
    assert(this.children.length === 2, 'we have 2 children');
    assert(this.splitType !== Two.NONE, 'split type set');
    const horizontal = this.splitType === Two.HORIZONTAL;
    const delta = horizontal ? dy : dx;
    const size = this._getBoundsSize();
    const oldSliderPos = fudge(size * this.sliderPercent);
    const newSliderPos = clamp(oldSliderPos + (delta | 0), splitMinSize, size - splitMinSize);
    const changed = oldSliderPos !== newSliderPos;
    if (changed) {
      this.sliderPercent = clamp(newSliderPos / size, 0, 1);
      this._slideFirstChildSlider(size, delta, true);
      this._slideSecondChildSlider(size, delta, true);
    }
    return changed;
  }

  private _slideFirstChildSlider(newSize: number, delta: number, keepFirstSize: boolean): void {
    if (this.children.length === 2) {
      const newFirstSize = fudge(newSize * this.sliderPercent);
      this.children[0]._slideSliderForNewSize(newFirstSize, delta, this.splitType, keepFirstSize);
    }
  }

  private _slideSecondChildSlider(newSize: number, delta: number, keepFirstSize: boolean): void {
    if (this.children.length === 2) {
      const newFirstSize = fudge(newSize * this.sliderPercent);
      const newSecondSize = newSize - newFirstSize - sliderSize;
      this.children[1]._slideSliderForNewSize(newSecondSize, delta, this.splitType, !keepFirstSize);
    }
  }

  private _slideSliderForNewSize(newSize: number, delta: number, parentSplitType: number, keepFirstSize: boolean): void {
    if (this.children.length !== 2 || this.splitType !== parentSplitType) {
      return;
    }
    if (keepFirstSize) {
      const oldSliderPos = fudge(this._getBoundsSize() * this.sliderPercent);
      const newSliderPos = oldSliderPos;
      this.sliderPercent = newSliderPos / newSize;
      this._slideSecondChildSlider(newSize, delta, false);
    } else {
      const oldSliderPos = fudge(this._getBoundsSize() * this.sliderPercent);
      const newSliderPos = oldSliderPos - delta;
      this.sliderPercent = newSliderPos / newSize;
      this._slideFirstChildSlider(newSize, delta, false);
    }
  }

  private _getBoundsSize(): number {
    return this.splitType === Two.HORIZONTAL ? this.bounds.height : this.bounds.width;
  }
}

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

type ViewerStateShape = {
  videoState: { playing: boolean };
};

type Props = {
  root: FolderStateRoot;
  options: Options;
  prefs: Preferences;
  winState: WinState;
  rotateMode: number;
  startingLayout?: TwoDump;
  setCurrentView: (vs: ViewSplit) => void;
  toolbarEventBus: ForwardableEventDispatcher;
};

type State = {
  treeVersion: number;
  currentId: number;
  dimensions: {
    width: number;
    height: number;
  };
};

@observer
export default class ViewSplit extends React.Component<Props, State> {
  private _logger: ReturnType<typeof debug>;
  private _root: Two;
  private _currentTwo: Two;
  private _currentView!: VPair;
  private _vpairs: Record<string, VPair>;
  private _twos: Record<string, Two>;
  private _viewers: IObservableArray<ViewerStateShape>;
  private _eventBus: ForwardableEventDispatcher;
  private _actionListener: ActionListener;
  private _saveLayout: _.DebouncedFunc<() => void>;
  private _currentSlider: Two | null = null;
  private _sliderMouseHandlersInstalled = false;
  private _lastX = 0;
  private _lastY = 0;

  constructor(props: Props) {
    super(props);
    this._logger = debug('ViewSplit');
    this._logger('ctor');

    this._saveLayout = _.debounce(this._doSaveLayout.bind(this), 500);

    const two = new Two();
    this._root = two;
    this._currentTwo = two;
    this._vpairs = {};
    this._twos = {};

    if (props.startingLayout) {
      this._currentTwo = this._root.restore(props.startingLayout, this._twos) ?? two;
    }

    this.state = {
      treeVersion: 0,  // eslint-disable-line
      currentId: 0,    // eslint-disable-line
      dimensions: {
        width: -1,
        height: -1,
      },
    };

    this._viewers = observable([]);

    this._eventBus = new ForwardableEventDispatcher();
    this._eventBus.debugId = this._logger.getPrefix();
    this._eventBus.on('action', this._handleActions);

    this._actionListener = new ActionListener();
    this._actionListener.on('splitHorizontal', this._splitHorizontal);
    this._actionListener.on('splitVertical', this._splitVertical);
    this._actionListener.on('splitHorizontalAlt', this._splitHorizontalAlt);
    this._actionListener.on('splitVerticalAlt', this._splitVerticalAlt);
    this._actionListener.on('deletePane', this._deletePane);
    this._actionListener.on('nextView', this._activateNextView);
    this._actionListener.on('prevView', this._activatePrevView);
    this._actionListener.on('playAll', this._playAll);
  }

  componentDidMount(): void {
    this.props.setCurrentView(this);
  }

  componentWillUnmount(): void {
    this._uninstallSliderMouseHandlers();
    this._actionListener.close();
  }

  getEventBus(): ForwardableEventDispatcher {
    return this._eventBus;
  }

  getAllVPairs(): VPair[] {
    return Object.values(this._vpairs);
  }

  getActiveViewState(): ReturnType<VPair['getState']> {
    return this._currentView.getState();
  }

  getViewerState(): ReturnType<VPair['getViewerState']> {
    return this._currentView.getViewerState();
  }

  getImagegridState(): ReturnType<VPair['getImagegridState']> {
    return this._currentView.getImagegridState();
  }

  anyPlaying(): boolean {
    return this._viewers.some(vs => vs.videoState.playing);
  }

  private _doSaveLayout(): void {
    for (const [twoId, vpair] of Object.entries(this._vpairs)) {
      const two = this._twos[twoId];
      if (two) {
        two.initialState = vpair.getState();
      }
    }
    ipcRenderer.send('saveSplitLayout', this._root.dump());
  }

  private _handleResize = (contentRect: { client: { width: number; height: number } }): void => {
    const width = contentRect.client.width;
    const height = contentRect.client.height;
    this._logger('old dim:', `${this.state.dimensions.width}x${this.state.dimensions.height}`, 'new dim:', `${width}x${height}`);
    if (this.state.dimensions.width !== width || this.state.dimensions.height !== height) {
      this.setState({
        dimensions: { width, height },
      });
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _handleActions = (event: any, ...args: unknown[]): void => {
    this._actionListener.routeAction(event, ...args);
  };

  private _bumpTreeVersion(): void {
    this._saveLayout();
    this.setState((prevState) => ({
      treeVersion: prevState.treeVersion + 1,
    }));
  }

  @action private _addViewer(viewerState: ViewerStateShape): void {
    this._viewers.push(viewerState);
  }

  @action private _removeViewer(viewerState: ViewerStateShape): void {
    this._viewers.replace(this._viewers.filter(s => s !== viewerState));
  }

  private _registerVPair = (vpair: VPair): void => {
    this._vpairs[vpair.props.twoId] = vpair;
    this._addViewer(vpair.getViewerState());
  };

  private _unregisterVPair = (vpair: VPair): void => {
    this._removeViewer(vpair.getViewerState());
    delete this._vpairs[vpair.props.twoId];
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _splitHorizontalImpl(forwardableEvent: any, newOnRight: boolean): void {
    forwardableEvent.stopPropagation();
    const stateOfViewBeingSplit = this.getActiveViewState();
    const two = this._currentTwo.split(Two.HORIZONTAL, newOnRight);
    two.initialState = stateOfViewBeingSplit;
    this._bumpTreeVersion();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _splitHorizontal = (forwardableEvent: any): void => {
    this._splitHorizontalImpl(forwardableEvent, false);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _splitHorizontalAlt = (forwardableEvent: any): void => {
    this._splitHorizontalImpl(forwardableEvent, true);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _splitVerticalImpl(forwardableEvent: any, newOnBottom: boolean): void {
    forwardableEvent.stopPropagation();
    const stateOfViewBeingSplit = this.getActiveViewState();
    const two = this._currentTwo.split(Two.VERTICAL, newOnBottom);
    two.initialState = stateOfViewBeingSplit;
    this._bumpTreeVersion();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _splitVertical = (forwardableEvent: any): void => {
    this._splitVerticalImpl(forwardableEvent, false);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _splitVerticalAlt = (forwardableEvent: any): void => {
    this._splitVerticalImpl(forwardableEvent, true);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _deletePane = (forwardableEvent: any): void => {
    forwardableEvent.stopPropagation();
    this._deleteCurrentPane();
  };

  private _deleteCurrentPane(): void {
    if (this._currentTwo !== this._root) {
      this._setCurrentViewFromTwo(this._currentTwo.delete());
      this._bumpTreeVersion();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _activateNextView = (forwardableEvent: any): void => {
    forwardableEvent.stopPropagation();
    const next = this._currentTwo.getNext();
    this._setCurrentViewFromTwo(next);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _activatePrevView = (forwardableEvent: any): void => {
    forwardableEvent.stopPropagation();
    const next = this._currentTwo.getPrev();
    this._setCurrentViewFromTwo(next);
  };

  private _setCurrentVPairAndTwo(vpair: VPair, two: Two): void {
    if (this._currentView) {
      this._currentView.getDownstreamEventBus().setForward(null);
    }
    this._currentView = vpair;
    this._currentTwo = two;
    this.props.setCurrentView(this);
    this._eventBus.setForward(vpair.getEventBus());
    vpair.getDownstreamEventBus().setForward(this.props.toolbarEventBus);
    this._bumpCurrentId();
  }

  private _setCurrentViewFromTwo(two: Two): void {
    const vpair = this._vpairs[two.id];
    assert(vpair);
    this._setCurrentVPairAndTwo(vpair, two);
  }

  private _setCurrentView = (vpair: VPair): void => {
    assert(vpair);
    assert(vpair.props.twoId);
    const two = this._twos[vpair.props.twoId];
    assert(two);
    this._setCurrentVPairAndTwo(vpair, two);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _playAll = (forwardableEvent: any): void => {
    forwardableEvent.stopPropagation();
    const anyPlaying = this.anyPlaying();
    for (const vpair of Object.values(this._vpairs)) {
      const act = { action: 'togglePlay' as const, force: !anyPlaying };
      const event = new ActionEvent(act, dummyEvent as Event);
      vpair.getEventBus().dispatch(event);
    }
  };

  private _bumpCurrentId(): void {
    this._saveLayout();
    this.setState((prevState) => ({
      currentId: prevState.currentId + 1,
    }));
  }

  private _handleSliderMouseDown = (e: MouseEvent, id: string): void => {
    e.stopPropagation();
    e.preventDefault();
    const two = this._twos[id];
    assert(two, 'found two for slider');
    this._currentSlider = two;
    this._logger('id:', id, 'two:', two);
    this._installSliderMouseHandlers();
    const mousePos = getRotatedXY(e, 'client', this.props.rotateMode);
    this._lastX = mousePos.x;
    this._lastY = mousePos.y;
  };

  private _handleSliderMouseMove = (e: MouseEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    assert(this._currentSlider, 'have current slider');
    const mousePos = getRotatedXY(e, 'client', this.props.rotateMode);
    const dx = mousePos.x - this._lastX;
    const dy = mousePos.y - this._lastY;
    this._lastX = mousePos.x;
    this._lastY = mousePos.y;
    this._logger('dx:', dx, 'dy:', dy);
    if (this._currentSlider!.slide(dx, dy)) {
      this._bumpTreeVersion();
    }
  };

  private _handleSliderMouseUp = (e: MouseEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    this._uninstallSliderMouseHandlers();
  };

  private _makeSliderMouseDownHandler(id: string): (e: React.MouseEvent) => void {
    return (e: React.MouseEvent) => {
      this._handleSliderMouseDown(e.nativeEvent, id);
    };
  }

  private _installSliderMouseHandlers(): void {
    if (!this._sliderMouseHandlersInstalled) {
      this._sliderMouseHandlersInstalled = true;
      window.addEventListener('mousemove', this._handleSliderMouseMove);
      window.addEventListener('mouseup', this._handleSliderMouseUp);
    }
  }

  private _uninstallSliderMouseHandlers(): void {
    this._currentSlider = null;
    if (this._sliderMouseHandlersInstalled) {
      this._sliderMouseHandlersInstalled = false;
      window.removeEventListener('mousemove', this._handleSliderMouseMove);
      window.removeEventListener('mouseup', this._handleSliderMouseUp);
    }
  }

  render(): React.ReactNode {
    this._logger('render');
    const width = this.state.dimensions.width;
    const height = this.state.dimensions.height;
    this._logger('Render:', 'width:', width, 'height:', height);
    const twos = this._root.layout(width, height);
    this._twos = {};
    const views = twos.map((two) => {
      this._twos[two.id] = two;
      const bounds = two.bounds;
      this._logger('splitType:', two.splitType, bounds);
      if (two.splitType === Two.NONE) {
        const style: React.CSSProperties = {
          position: 'absolute',
          left: px(bounds.left),
          top: px(bounds.top),
          width: px(bounds.width),
          height: px(bounds.height),
        };
        return (
          <div
            className="viewholder"
            style={style}
            key={two.id}
          >
            <VPair
              root={this.props.root}
              twoId={two.id}
              initialState={two.initialState as never}
              width={bounds.width}
              isCurrentView={this._currentTwo === two}
              options={this.props.options}
              prefs={this.props.prefs}
              winState={this.props.winState}
              rotateMode={this.props.rotateMode}
              eventBus={this._eventBus}
              setCurrentView={this._setCurrentView}
              actionListener={this._actionListener}
              registerVPair={this._registerVPair}
              unregisterVPair={this._unregisterVPair}
              saveLayout={this._saveLayout}
            />
          </div>
        );
      } else {
        const rot90 = (this.props.rotateMode % 2) !== 0;
        const horizontal = two.splitType === Two.HORIZONTAL;
        const style: React.CSSProperties = horizontal ? {
          position: 'absolute',
          width: px(bounds.width),
          height: px(sliderSize),
          left: px(bounds.left),
          top: px(two.sliderPos),
        } : {
          position: 'absolute',
          width: px(sliderSize),
          height: px(bounds.height),
          left: px(two.sliderPos),
          top: px(bounds.top),
        };
        const sliderCursorHorizontal = horizontal ? !rot90 : rot90;
        this._logger('sliderCurH:', sliderCursorHorizontal, rot90);
        return (
          <div
            className={`split-slider split-slider-${sliderCursorHorizontal ? 'horizontal' : 'vertical'}`}
            style={style}
            key={two.id}
            onMouseDown={this._makeSliderMouseDownHandler(two.id)}
          />
        );
      }
    });
    return (
      <ResizeSensor onResize={this._handleResize}>
        {({ measureRef }) => (
          <div
            style={{ position: 'relative', width: '100%', height: '100%' }}
            ref={measureRef}
          >
            {views}
          </div>
        )}
      </ResizeSensor>
    );
  }
}
