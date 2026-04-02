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

import React, { useRef, useState } from 'react';
import { getRotatedXY } from '../rotatehelper';

// Two-pane splitter layout with a draggable divider.
//
// The layout is always a logical side-by-side split (flex-direction: row).
// The parent's CSS rotation (deg0 / deg90 / deg180 / deg270 on the .view
// element) transforms the visual appearance — the SplitPane itself does not
// change its flex direction.
//
// Drag events arrive in *screen* coordinates, so we use getRotatedXY to
// convert them to the logical coordinate system before computing the new
// split fraction.  container.offsetWidth gives the pre-transform logical
// width, which is the correct denominator for the fraction regardless of
// how the parent is visually rotated.
//
// `initialSplit` (0–1) is the initial flex fraction for the first pane and
// is only read on mount — the component manages position internally after
// that.  `onSplitChange` is called on every drag move so the parent can
// persist the value for the next session.

export interface SplitPaneProps {
  rotateMode: number;
  initialSplit?: number;
  minSize?: number;
  firstClassName?: string;
  secondClassName?: string;
  splitterClassName?: string;
  onSplitChange?: (flex: number) => void;
  first: React.ReactNode;
  second: React.ReactNode;
}

export default function SplitPane({
  rotateMode,
  initialSplit = 0.2,
  minSize = 0,
  firstClassName = '',
  secondClassName = '',
  splitterClassName = '',
  onSplitChange,
  first,
  second,
}: SplitPaneProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(initialSplit);
  const [isDragging, setIsDragging] = useState(false);

  // Logical drag-start position and split fraction, tracked across moves.
  const startLogicalX = useRef(0);
  const startSplit = useRef(split);

  // After the parent's CSS rotation, col-resize appears as row-resize to the
  // user when rotated 90° or 270°.
  const cursor = rotateMode % 2 === 0 ? 'col-resize' : 'row-resize';

  const getLogicalX = (e: React.PointerEvent): number =>
    getRotatedXY(e, 'client', rotateMode).x;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startLogicalX.current = getLogicalX(e);
    startSplit.current = split;
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const container = containerRef.current;
    if (!container) return;

    // offsetWidth is the pre-transform logical width — correct denominator
    // regardless of how the parent is CSS-rotated.
    const logicalSize = container.offsetWidth;
    const delta = getLogicalX(e) - startLogicalX.current;

    const rawSplit = startSplit.current + delta / logicalSize;
    const minFlex = minSize > 0 ? minSize / logicalSize : 0;
    const newSplit = Math.max(minFlex, Math.min(1 - minFlex, rawSplit));

    setSplit(newSplit);
    onSplitChange?.(newSplit);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);
  };

  const splitterClasses = [
    'split-pane-splitter',
    isDragging ? 'active' : '',
    splitterClassName,
  ].filter(Boolean).join(' ');

  return (
    <div ref={containerRef} className="split-pane">
      <div style={{ flex: `0 0 ${split * 100}%` }} className={`split-pane-first ${firstClassName}`}>
        {first}
      </div>
      <div
        className={splitterClasses}
        style={{ cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div className={`split-pane-second ${secondClassName}`}>
        {second}
      </div>
    </div>
  );
}
