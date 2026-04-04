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
import _ from 'lodash';
import { actions, ActionId } from '../../lib/actions';
import debug from '../../lib/debug';
import ForwardableEvent from '../../lib/forwardable-event';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher';
import gridModes, { GridMode } from './grid-modes';
import ActionEvent from '../../lib/action-event';
import { sortModes, SortMode } from './folder-state-helper';
import { ImagegridStateHolder } from './viewer-events';

class SetCollectionEvent extends ForwardableEvent {
  collection: unknown;
  constructor(collection: unknown) {
    super('setCollection');
    this.collection = collection;
  }
}

type RangeProps = {
  value: number;
  min: number;
  max: number;
  onUpdate: React.ChangeEventHandler<HTMLInputElement>;
};

class Range extends React.Component<RangeProps> {
  private id: string;
  constructor(props: RangeProps) {
    super(props);
    this.id = _.uniqueId('Range');
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

type Collection = { name: string };

type Props = {
  actions: { [key in ActionId]: () => void };
  zoom: number;
  sortMode: SortMode;
  gridMode: GridMode;
  collections: Collection[];
  setThumbnailZoom: (zoom: number) => void;
  outEventBus: ForwardableEventDispatcher;
  imagegridStateHolder: ImagegridStateHolder;
  filter: string;
  handleUpdateFilter: (value: string) => void;
  filterInputBlurred: () => void;
  filterInputFocused: () => void;
};

export default class ImagegridsToolbar extends React.Component<Props> {
  private _logger: ReturnType<typeof debug>;

  constructor(props: Props) {
    super(props);
    this._logger = debug('ImagegridsToolbar');
  }

  private _makeButton(actionName: ActionId): React.ReactNode {
    const actionFuncs = this.props.actions;
    const action = actions[actionName];
    return (
      <button type="button" onClick={actionFuncs[actionName]} data-tooltip={action.hint}>
        <img src={action.icon} />
      </button>
    );
  }

  private _handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      (event.target as HTMLInputElement).blur();
    }
  };

  private _updateFilter = (event: React.ChangeEvent<HTMLInputElement>): void => {
    this.props.handleUpdateFilter(event.target.value);
  };

  private _changeGridMode = (): void => {
    this.props.outEventBus.dispatch(new ActionEvent({ action: 'cycleGridMode' }));
  };

  private _changeSortMode = (): void => {
    this.props.outEventBus.dispatch(new ActionEvent({ action: 'cycleSortMode' }));
  };

  private _selectCollection = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    this.props.outEventBus.dispatch(
      new SetCollectionEvent(this.props.collections[Number(event.target.value) | 0]),
    );
  };

  render(): React.ReactNode {
    this._logger('render');
    const gridMode = gridModes.value(this.props.gridMode) || { icon: 'images/bad.png', hint: '' };
    const sortMode = sortModes.value(this.props.sortMode) || { icon: 'images/bad.png', hint: '' };
    return (
      <div className="toolbar imagegridstoolbar">
        {/*
        {this._makeButton('newCollection')}
        {this._makeButton('editCollection')}
        <div data-tooltip="collection">
          <select
            value={this.props.collections.indexOf(imagegridState.currentCollection)}
            onChange={this._selectCollection}
          >
            <option key="collection--1" value="-1">all/none</option>
            {this.props.collections.map((collection, ndx) => {
              return (
                <option key={`collection-${ndx}`} value={ndx}>{collection.name}</option>
              );
            })}
          </select>
        </div>
        */}
        <div className="button-group">
          <button type="button" onClick={this._changeGridMode} data-tooltip={gridMode.hint}><img src={gridMode.icon} /></button>
          <button type="button" onClick={this._changeSortMode} data-tooltip={sortMode.hint}><img src={sortMode.icon} /></button>
        </div>
        <div className="zoom tooltip-high" data-tooltip="zoom">
          <Range
            value={this.props.zoom * 100}
            min={25}
            max={200}
            onUpdate={(e) => { this.props.setThumbnailZoom((Number(e.target.value) | 0) / 100); }}
          />
        </div>
        <div className="filter tooltip-high" data-tooltip="filter">
          <input
            placeholder="*.gif width:>100 type:jpeg folder:foo*"
            type="text"
            value={this.props.filter}
            onChange={this._updateFilter}
            onKeyPress={this._handleKeyPress}
            onBlur={this.props.filterInputBlurred}
            onFocus={this.props.filterInputFocused}
          />
        </div>
        <div className="button-group">
          {this._makeButton('splitVertical')}
          {this._makeButton('splitHorizontal')}
          {this._makeButton('deletePane')}
          {this._makeButton('showHelp')}
        </div>
      </div>
    );
  }
}
