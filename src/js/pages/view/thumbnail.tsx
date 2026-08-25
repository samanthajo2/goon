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
import ForwardableEvent from '../../lib/forwardable-event.js';
import gridModes, { ThumbnailProps } from './grid-modes.js';
import { AppContext } from './contexts.js';
import { isSelected, selectionCount, getSelectedFilenames, getSelectedEntries } from './selection-state.js';
import { setDragContext } from './drag-context.js';

type Props = ThumbnailProps & {
  count: number;
  setCurrentView: () => void;
};

export default class Thumbnail extends React.PureComponent<Props> {
  static contextType = AppContext;
  declare context: React.ContextType<typeof AppContext>;

  // We preventDefault() the dragstart and use Electron's native drag instead.
  // The browser sees no drag, so it fires a click on mouseup. Suppress that click.
  private _draggedSincePointerDown = false;

  private _handlePointerDown = (): void => {
    this._draggedSincePointerDown = false;
  };

  private _viewImage = (e: React.MouseEvent): void => {
    if (this._draggedSincePointerDown) return;
    // Cmd/Ctrl-click toggles selection (a bigger target than the checkbox).
    // Shift-click (with or without Cmd/Ctrl) extends the range from the last
    // selected item to this one — same as Shift-clicking the checkbox, but you
    // don't have to hit the small box. A plain click views the item.
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      this.context.eventBus.dispatch(
        new ForwardableEvent('toggleSelection'),
        this.props.folderKey,
        this.props.info.filename,
        e.shiftKey,
      );
      return;
    }
    this.props.setCurrentView();
    this.context.eventBus.dispatch(new ForwardableEvent('setCurrentNdx'), this.props.count);
    this.context.eventBus.dispatch(new ForwardableEvent('view'), this.props.info);
  };

  private _handleContextMenu = (event: MouseEvent | React.MouseEvent): void => {
    const domEvent = (event instanceof MouseEvent) ? event : event.nativeEvent;
    this.context.eventBus.dispatch(new ForwardableEvent('fileContextMenu', domEvent), this.props.info, this.props.folderKey);
  };

  private _handleDragStart = (event: DragEvent | React.DragEvent): void => {
    const domEvent = (event instanceof DragEvent) ? event : event.nativeEvent;
    domEvent.preventDefault();
    this._draggedSincePointerDown = true;
    const startDrag = this.context.platform.startDrag;
    if (!startDrag) return;
    const filename = this.props.info.filename;
    // If the dragged item is part of the selection, drag the whole selection
    // (which can span folders). Otherwise drag just this one entry.
    const multi = isSelected(this.props.folderKey, filename) && selectionCount() > 1;
    const entries = multi ? getSelectedEntries() : [{ folderKey: this.props.folderKey, filename }];
    // Record the dragged entries so a drop back inside the app is treated as internal.
    setDragContext({ entries });
    // Dragging out hands unique file paths to the OS.
    startDrag(multi ? getSelectedFilenames() : filename);
  };

  // Clear the drag context when the drag ends (dropped externally or cancelled) so
  // a later unrelated drop can't act on stale source info. A successful internal
  // drop clears it too (in the drop handler), so this is the belt-and-suspenders.
  private _handleDragEnd = (): void => {
    setDragContext(null);
  };

  private _handleCheckboxClick = (event: React.MouseEvent): void => {
    event.stopPropagation();
    event.preventDefault();
    this.context.eventBus.dispatch(
      new ForwardableEvent('toggleSelection'),
      this.props.folderKey,
      this.props.info.filename,
      event.shiftKey,
    );
  };

  render(): React.ReactNode {
    // Inject fileToUrl into the props so style helpers can translate the
    // raw paths the thumber sent into platform-appropriate URLs.
    const props = { ...this.props, fileToUrl: this.context.platform.fileToUrl };
    return gridModes.value(props.gridMode).render(
      props,
      this._viewImage,
      this._handleContextMenu,
      this._handleDragStart,
      this._handlePointerDown,
      this._handleCheckboxClick,
      this._handleDragEnd,
    );
  }
}
