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
import ResizeSensor from '../../lib/ui/resize-sensor.js';
import { debounce, CancelableFn } from '../../lib/utils.js';
import { ipcRenderer } from '../../lib/electron-imports.js';
import debug from '../../lib/debug.js';
import VPair from './vpair.js';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher.js';
import ForwardableEvent from '../../lib/forwardable-event.js';
import type { AppEventMap } from './app-event-map.js';
import ActionEvent from '../../lib/action-event.js';
import ActionListener from '../../lib/action-listener.js';
import { getRotatedXY } from '../../lib/rotatehelper.js';
import { px } from '../../lib/utils.js';
import { FolderStateRoot } from './folder-state-helper.js';
import { GridMode } from './grid-modes.js';

const SLIDER_SIZE = 5;
const MIN_SIZE_FRAC = 0.02;

const dummyEvent = {
  preventDefault: () => {},
  stopPropagation: () => {},
};

// ── Container/Leaf tree model ──────────────────────────────────────

type Direction = 'h' | 'v';

let g_nextId = 0;
function nextId(): string {
  return `pane-${++g_nextId}`;
}

class Leaf {
  readonly id: string;
  initialState?: unknown;
  parent: Container | null = null;

  constructor(id?: string, initialState?: unknown) {
    this.id = id ?? nextId();
    this.initialState = initialState;
  }
}

type Node = Leaf | Container;

class Container {
  direction: Direction;
  children: Node[];
  sizes: number[];
  parent: Container | null = null;

  constructor(direction: Direction, children: Node[], sizes: number[]) {
    this.direction = direction;
    this.children = children;
    this.sizes = sizes;
    for (const child of children) {
      child.parent = this;
    }
  }
}

function isLeaf(node: Node): node is Leaf {
  return node instanceof Leaf;
}

// ── Collect all leaves ─────────────────────────────────────────────

function allLeaves(node: Node): Leaf[] {
  if (isLeaf(node)) return [node];
  const result: Leaf[] = [];
  for (const child of node.children) {
    result.push(...allLeaves(child));
  }
  return result;
}

function findLeaf(root: Node, id: string): Leaf | null {
  if (isLeaf(root)) return root.id === id ? root : null;
  for (const child of root.children) {
    const found = findLeaf(child, id);
    if (found) return found;
  }
  return null;
}

// ── Layout ─────────────────────────────────────────────────────────

type PixelRect = { left: number; top: number; width: number; height: number };

type DividerInfo = {
  id: string;
  container: Container;
  childIndex: number;
  orientation: Direction;
  x: number;
  y: number;
  width: number;
  height: number;
};

type LayoutResult = {
  leaves: Map<string, PixelRect>;
  dividers: DividerInfo[];
};

let g_divId = 0;

function computeLayout(
  node: Node,
  left: number,
  top: number,
  width: number,
  height: number,
  gapless: boolean,
): LayoutResult {
  const leaves = new Map<string, PixelRect>();
  const dividers: DividerInfo[] = [];

  function walk(n: Node, l: number, t: number, w: number, h: number): void {
    if (isLeaf(n)) {
      leaves.set(n.id, { left: l, top: t, width: w, height: h });
      return;
    }
    const dir = n.direction;
    const totalSize = dir === 'h' ? w : h;
    const numDividers = n.children.length - 1;
    const dividerSpace = gapless ? 0 : SLIDER_SIZE;
    const availableForChildren = totalSize - numDividers * dividerSpace;

    let offset = 0;
    for (let i = 0; i < n.children.length; i++) {
      const childSize = Math.round(availableForChildren * n.sizes[i]);
      if (dir === 'h') {
        walk(n.children[i], l + offset, t, childSize, h);
      } else {
        walk(n.children[i], l, t + offset, w, childSize);
      }
      offset += childSize;

      if (i < n.children.length - 1) {
        if (dir === 'h') {
          dividers.push({
            id: `div-${g_divId++}`,
            container: n,
            childIndex: i,
            orientation: 'h',
            x: l + offset,
            y: t,
            width: dividerSpace || SLIDER_SIZE,
            height: h,
          });
        } else {
          dividers.push({
            id: `div-${g_divId++}`,
            container: n,
            childIndex: i,
            orientation: 'v',
            x: l,
            y: t + offset,
            width: w,
            height: dividerSpace || SLIDER_SIZE,
          });
        }
        offset += dividerSpace;
      }
    }
  }

  walk(node, left, top, width, height);
  return { leaves, dividers };
}

// ── Operations ─────────────────────────────────────────────────────

function splitLeaf(leaf: Leaf, direction: Direction, newSecond: boolean): Leaf {
  const parent = leaf.parent;
  const newLeaf = new Leaf();

  if (parent && parent.direction === direction) {
    // Same direction — insert sibling into existing container
    const ndx = parent.children.indexOf(leaf);
    const halfSize = parent.sizes[ndx] / 2;
    parent.sizes[ndx] = halfSize;
    const insertNdx = newSecond ? ndx + 1 : ndx;
    newLeaf.parent = parent;
    parent.children.splice(insertNdx, 0, newLeaf);
    parent.sizes.splice(insertNdx, 0, halfSize);
  } else {
    // Different direction — wrap leaf in a new container
    const newContainer = new Container(
      direction,
      newSecond ? [leaf, newLeaf] : [newLeaf, leaf],
      [0.5, 0.5],
    );
    if (parent) {
      const ndx = parent.children.indexOf(leaf);
      parent.children[ndx] = newContainer;
      newContainer.parent = parent;
    }
    leaf.parent = newContainer;
    newLeaf.parent = newContainer;
  }
  return newLeaf;
}

function deleteLeaf(root: Node, leaf: Leaf): { root: Node; neighborLeaf: Leaf } {
  const parent = leaf.parent;
  if (!parent) return { root, neighborLeaf: leaf };

  const ndx = parent.children.indexOf(leaf);
  const neighborNdx = ndx < parent.children.length - 1 ? ndx + 1 : ndx - 1;
  const neighborNode = parent.children[neighborNdx];

  // Give space to neighbor then remove
  // neighborNdx may shift after splice if ndx < neighborNdx
  const neighborSize = parent.sizes[neighborNdx] + parent.sizes[ndx];
  parent.children.splice(ndx, 1);
  parent.sizes.splice(ndx, 1);
  // Find where the neighbor ended up after the splice
  const newNeighborNdx = parent.children.indexOf(neighborNode);
  parent.sizes[newNeighborNdx] = neighborSize;

  // Collapse container if only one child remains
  let newRoot = root;
  if (parent.children.length === 1) {
    const onlyChild = parent.children[0];
    const grandparent = parent.parent;
    if (grandparent) {
      const pNdx = grandparent.children.indexOf(parent);
      const parentSize = grandparent.sizes[pNdx];
      // If the only child is a container with the same direction as grandparent, flatten
      if (!isLeaf(onlyChild) && onlyChild.direction === grandparent.direction) {
        grandparent.children.splice(pNdx, 1, ...onlyChild.children);
        grandparent.sizes.splice(pNdx, 1, ...onlyChild.sizes.map(s => s * parentSize));
        for (const c of onlyChild.children) c.parent = grandparent;
      } else {
        grandparent.children[pNdx] = onlyChild;
        grandparent.sizes[pNdx] = parentSize;
        onlyChild.parent = grandparent;
      }
    } else {
      onlyChild.parent = null;
      newRoot = onlyChild;
    }
  }

  // Find the first leaf in the neighbor subtree
  let result: Node = neighborNode;
  while (!isLeaf(result)) result = result.children[0];
  return { root: newRoot, neighborLeaf: result };
}

// ── Divider drag ───────────────────────────────────────────────────

function dragDivider(divider: DividerInfo, deltaPx: number, totalPx: number): boolean {
  const container = divider.container;
  const i = divider.childIndex;
  const deltaFrac = deltaPx / totalPx;

  const newA = container.sizes[i] + deltaFrac;
  const newB = container.sizes[i + 1] - deltaFrac;
  if (newA < MIN_SIZE_FRAC || newB < MIN_SIZE_FRAC) return false;

  container.sizes[i] = newA;
  container.sizes[i + 1] = newB;
  return true;
}

// ── Navigation ─────────────────────────────────────────────────────

function getNextLeaf(root: Node, currentId: string): Leaf {
  const leaves = allLeaves(root);
  const ndx = leaves.findIndex(l => l.id === currentId);
  return leaves[(ndx + 1) % leaves.length];
}

function getPrevLeaf(root: Node, currentId: string): Leaf {
  const leaves = allLeaves(root);
  const ndx = leaves.findIndex(l => l.id === currentId);
  return leaves[(ndx - 1 + leaves.length) % leaves.length];
}

// ── Serialization ──────────────────────────────────────────────────

type LayoutDump = {
  type: 'leaf';
  initialState?: unknown;
} | {
  type: 'container';
  direction: Direction;
  sizes: number[];
  children: LayoutDump[];
};

// Old format for backward compatibility
type TwoDump = {
  splitType: number;
  sliderPercent: number;
  children: TwoDump[];
  initialState?: unknown;
};

function dumpNode(node: Node): LayoutDump {
  if (isLeaf(node)) {
    const result: LayoutDump = { type: 'leaf' };
    if (node.initialState !== undefined) {
      (result as { type: 'leaf'; initialState?: unknown }).initialState = node.initialState;
    }
    return result;
  }
  return {
    type: 'container',
    direction: node.direction,
    sizes: node.sizes.slice(),
    children: node.children.map(dumpNode),
  };
}

function restoreNode(dump: LayoutDump): Node {
  if (dump.type === 'leaf') {
    return new Leaf(undefined, dump.initialState);
  }
  const children = dump.children.map(restoreNode);
  return new Container(dump.direction, children, dump.sizes.slice());
}

// Detect and restore old TwoDump format
function isOldFormat(dump: unknown): dump is TwoDump {
  return dump !== null && typeof dump === 'object' && 'splitType' in (dump as TwoDump);
}

function restoreFromOldDump(dump: TwoDump): Node {
  if (dump.splitType === 0 || dump.children.length === 0) {
    return new Leaf(undefined, dump.initialState);
  }
  const direction: Direction = dump.splitType === 1 ? 'v' : 'h';
  const child0 = restoreFromOldDump(dump.children[0]);
  const child1 = restoreFromOldDump(dump.children[1]);

  // Flatten children with same direction
  const children: Node[] = [];
  const sizes: number[] = [];
  const p = dump.sliderPercent;

  if (!isLeaf(child0) && child0.direction === direction) {
    children.push(...child0.children);
    sizes.push(...child0.sizes.map(s => s * p));
  } else {
    children.push(child0);
    sizes.push(p);
  }

  if (!isLeaf(child1) && child1.direction === direction) {
    children.push(...child1.children);
    sizes.push(...child1.sizes.map(s => s * (1 - p)));
  } else {
    children.push(child1);
    sizes.push(1 - p);
  }

  return new Container(direction, children, sizes);
}

function restoreLayout(dump: unknown): Node {
  if (!dump || typeof dump !== 'object') return new Leaf();
  if (isOldFormat(dump)) return restoreFromOldDump(dump);
  return restoreNode(dump as LayoutDump);
}

// ── ViewSplit component ────────────────────────────────────────────

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
  winState: WinState;
  rotateMode: number;
  gaplessDividers?: boolean;
  startingLayout?: unknown;
  setCurrentView: (vs: ViewSplit) => void;
  toolbarEventBus: ForwardableEventDispatcher;
  onViewingChanged?: (viewing: boolean) => void;
};

type State = {
  treeVersion: number;
  currentId: number;
  dimensions: {
    width: number;
    height: number;
  };
};

export default class ViewSplit extends React.Component<Props, State> {
  private _logger: ReturnType<typeof debug>;
  private _treeRoot: Node;
  private _currentLeafId: string;
  private _currentView!: VPair;
  private _vpairs: Record<string, VPair>;
  private _viewers: ViewerStateShape[];
  private _eventBus: ForwardableEventDispatcher<AppEventMap>;
  private _actionListener: ActionListener;
  private _saveLayout: CancelableFn;
  private _currentDivider: DividerInfo | null = null;
  private _lastDividers: DividerInfo[] = [];
  private _activePointerId: number | null = null;
  private _lastX = 0;
  private _lastY = 0;

  constructor(props: Props) {
    super(props);
    this._logger = debug('ViewSplit');

    this._saveLayout = debounce(this._doSaveLayout.bind(this), 500);

    this._treeRoot = props.startingLayout
      ? restoreLayout(props.startingLayout)
      : new Leaf();

    const leaves = allLeaves(this._treeRoot);
    this._currentLeafId = leaves[0].id;
    this._vpairs = {};

    this.state = {
      treeVersion: 0,
      currentId: 0,
      dimensions: { width: -1, height: -1 },
    };

    this._viewers = [];

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
    // Only notify parent if we have a current view (VPairs may not be
    // rendered yet if dimensions haven't been measured).
    if (this._currentView) {
      this.props.setCurrentView(this);
    }
  }

  componentWillUnmount(): void {
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
    for (const leaf of allLeaves(this._treeRoot)) {
      const vpair = this._vpairs[leaf.id];
      if (vpair) leaf.initialState = vpair.getState();
    }
    ipcRenderer.send('saveSplitLayout', dumpNode(this._treeRoot));
  }

  private _handleResize = (contentRect: { client: { width: number; height: number } }): void => {
    const { width, height } = contentRect.client;
    if (this.state.dimensions.width !== width || this.state.dimensions.height !== height) {
      this.setState({ dimensions: { width, height } });
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _handleActions = (event: any, ...args: unknown[]): void => {
    this._actionListener.routeAction(event, ...args);
  };

  private _bumpTreeVersion(): void {
    this._saveLayout();
    this.setState((s) => ({ treeVersion: s.treeVersion + 1 }));
  }

  private _registerVPair = (vpair: VPair): void => {
    this._vpairs[vpair.props.twoId] = vpair;
    this._viewers.push(vpair.getViewerState());
    if (vpair.props.twoId === this._currentLeafId) {
      this._currentView = vpair;
      this._eventBus.setForward(vpair.getEventBus());
      vpair.getDownstreamEventBus().setForward(this.props.toolbarEventBus);
      this.props.setCurrentView(this);
    }
  };

  private _unregisterVPair = (vpair: VPair): void => {
    this._viewers = this._viewers.filter(s => s !== vpair.getViewerState());
    delete this._vpairs[vpair.props.twoId];
  };

  private _getCurrentLeaf(): Leaf | null {
    return findLeaf(this._treeRoot, this._currentLeafId);
  }

  private _findRoot(): Node {
    let r: Node = this._treeRoot;
    while (r.parent) r = r.parent;
    return r;
  }

  // ── Split ──────────────────────────────────────────────────────

  private _doSplit(direction: Direction, newSecond: boolean): void {
    const leaf = this._getCurrentLeaf();
    if (!leaf) return;
    const state = this.getActiveViewState();
    const newLeaf = splitLeaf(leaf, direction, newSecond);
    newLeaf.initialState = state;
    this._treeRoot = this._findRoot();
    this._bumpTreeVersion();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _splitHorizontal = (fe: any): void => { fe.stopPropagation(); this._doSplit('v', false); };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _splitHorizontalAlt = (fe: any): void => { fe.stopPropagation(); this._doSplit('v', true); };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _splitVertical = (fe: any): void => { fe.stopPropagation(); this._doSplit('h', false); };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _splitVerticalAlt = (fe: any): void => { fe.stopPropagation(); this._doSplit('h', true); };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _deletePane = (fe: any): void => {
    fe.stopPropagation();
    const leaf = this._getCurrentLeaf();
    if (!leaf) return;
    if (allLeaves(this._treeRoot).length <= 1) {
      // Last pane: if it's showing the Viewer, switch back to ImageGrids.
      if (this._currentView) {
        this._currentView.getEventBus().dispatch(new ForwardableEvent('hide'));
      }
      return;
    }
    const { root, neighborLeaf } = deleteLeaf(this._treeRoot, leaf);
    this._treeRoot = root;
    this._currentLeafId = neighborLeaf.id;
    this._bumpTreeVersion();
    setTimeout(() => {
      if (this._vpairs[neighborLeaf.id]) {
        this._setCurrentVPairById(neighborLeaf.id);
      }
    }, 0);
  };

  // ── Navigation ─────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _activateNextView = (fe: any): void => {
    fe.stopPropagation();
    this._setCurrentVPairById(getNextLeaf(this._treeRoot, this._currentLeafId).id);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _activatePrevView = (fe: any): void => {
    fe.stopPropagation();
    this._setCurrentVPairById(getPrevLeaf(this._treeRoot, this._currentLeafId).id);
  };

  private _setCurrentVPairById(leafId: string): void {
    const vpair = this._vpairs[leafId];
    if (!vpair) return;
    if (this._currentView) {
      this._currentView.getDownstreamEventBus().setForward(null);
    }
    this._currentView = vpair;
    this._currentLeafId = leafId;
    this.props.setCurrentView(this);
    this._eventBus.setForward(vpair.getEventBus());
    vpair.getDownstreamEventBus().setForward(this.props.toolbarEventBus);
    this.props.onViewingChanged?.(vpair.getViewerState().viewing);
    vpair.notifyToolbarOfCurrentState();
    this._bumpCurrentId();
  }

  private _setCurrentView = (vpair: VPair): void => {
    this._setCurrentVPairById(vpair.props.twoId);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _playAll = (fe: any): void => {
    fe.stopPropagation();
    const anyPlaying = this.anyPlaying();
    for (const vpair of Object.values(this._vpairs)) {
      const act = { action: 'togglePlay' as const, force: !anyPlaying };
      const event = new ActionEvent(act, dummyEvent as Event);
      vpair.getEventBus().dispatch(event);
    }
  };

  private _bumpCurrentId(): void {
    this._saveLayout();
    this.setState((s) => ({ currentId: s.currentId + 1 }));
  }

  // ── Slider pointer handling ────────────────────────────────────
  // Uses setPointerCapture so all subsequent pointer events route to the
  // divider element, even if the pointer leaves it. No global listeners
  // needed and no risk of getting stuck mid-drag.

  private _handleSliderPointerDown = (e: React.PointerEvent<HTMLDivElement>, dividerId: string): void => {
    if (e.button !== 0) return; // primary button / touch / pen tip only
    e.stopPropagation();
    e.preventDefault();
    this._currentDivider = this._lastDividers.find(d => d.id === dividerId) ?? null;
    if (!this._currentDivider) return;
    this._activePointerId = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = getRotatedXY(e.nativeEvent, 'client', this.props.rotateMode);
    this._lastX = pos.x;
    this._lastY = pos.y;
  };

  private _handleSliderPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (this._activePointerId !== e.pointerId || !this._currentDivider) return;
    e.stopPropagation();
    e.preventDefault();
    const pos = getRotatedXY(e.nativeEvent, 'client', this.props.rotateMode);
    const dx = pos.x - this._lastX;
    const dy = pos.y - this._lastY;
    this._lastX = pos.x;
    this._lastY = pos.y;

    const { width, height } = this.state.dimensions;
    const deltaPx = this._currentDivider.orientation === 'h' ? dx : dy;
    const totalPx = this._currentDivider.orientation === 'h' ? width : height;

    if (dragDivider(this._currentDivider, deltaPx, totalPx)) {
      this._bumpTreeVersion();
    }
  };

  private _handleSliderPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (this._activePointerId !== e.pointerId) return;
    e.stopPropagation();
    e.preventDefault();
    this._activePointerId = null;
    this._currentDivider = null;
    // setPointerCapture is implicitly released on pointerup, but be explicit
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  private _makeSliderPointerDownHandler(dividerId: string): (e: React.PointerEvent<HTMLDivElement>) => void {
    return (e) => this._handleSliderPointerDown(e, dividerId);
  }

  // ── Render ─────────────────────────────────────────────────────

  render(): React.ReactNode {
    const { width, height } = this.state.dimensions;
    const gapless = !!this.props.gaplessDividers;

    // Don't render content until we have valid dimensions from ResizeSensor
    if (width <= 0 || height <= 0) {
      return (
        <ResizeSensor onResize={this._handleResize}>
          {({ measureRef }) => (
            <div
              style={{ position: 'relative', width: '100%', height: '100%' }}
              ref={measureRef}
            />
          )}
        </ResizeSensor>
      );
    }

    g_divId = 0;
    const layout = computeLayout(this._treeRoot, 0, 0, width, height, gapless);
    this._lastDividers = layout.dividers;
    const rot90 = (this.props.rotateMode % 2) !== 0;

    const leafViews = allLeaves(this._treeRoot).map((leaf) => {
      const rect = layout.leaves.get(leaf.id)!;
      const style: React.CSSProperties = {
        position: 'absolute',
        left: px(rect.left),
        top: px(rect.top),
        width: px(rect.width),
        height: px(rect.height),
      };
      return (
        <div className="viewholder" style={style} key={leaf.id}>
          <VPair
            root={this.props.root}
            twoId={leaf.id}
            initialState={leaf.initialState as never}
            width={rect.width}
            isCurrentView={this._currentLeafId === leaf.id}
            options={this.props.options}
            winState={this.props.winState}
            rotateMode={this.props.rotateMode}
            setCurrentView={this._setCurrentView}
            actionListener={this._actionListener}
            registerVPair={this._registerVPair}
            unregisterVPair={this._unregisterVPair}
            saveLayout={this._saveLayout}
            onViewingChanged={this.props.onViewingChanged}
          />
        </div>
      );
    });

    const dividerViews = layout.dividers.map((div) => {
      const isHContainer = div.orientation === 'h';
      const offset = gapless ? Math.floor(SLIDER_SIZE / 2) : 0;
      const style: React.CSSProperties = {
        position: 'absolute',
        left: px(div.x - (isHContainer ? offset : 0)),
        top: px(div.y - (isHContainer ? 0 : offset)),
        width: px(div.width),
        height: px(div.height),
      };
      const cursorHorizontal = isHContainer ? rot90 : !rot90;
      return (
        <div
          className={`split-slider split-slider-${cursorHorizontal ? 'horizontal' : 'vertical'}`}
          style={style}
          key={div.id}
          onPointerDown={this._makeSliderPointerDownHandler(div.id)}
          onPointerMove={this._handleSliderPointerMove}
          onPointerUp={this._handleSliderPointerUp}
          onPointerCancel={this._handleSliderPointerUp}
        />
      );
    });

    return (
      <ResizeSensor onResize={this._handleResize}>
        {({ measureRef }) => (
          <div
            style={{ position: 'relative', width: '100%', height: '100%' }}
            className={gapless ? 'gapless-dividers' : undefined}
            ref={measureRef}
          >
            {leafViews}
            {dividerViews}
          </div>
        )}
      </ResizeSensor>
    );
  }
}
