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

import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';

// VirtualList renders only the items visible in its scroll viewport plus an
// overscan buffer, maintaining the correct total scroll height with spacer
// divs above and below.
//
// The component is its own scroll container (overflow: auto). Callers can
// pass className / onScroll / style to customise it exactly as they would a
// plain <div>.
//
// The imperative handle exposes:
//   scrollTo(index)  – scroll so the item at `index` is at the top of the viewport
//   domElement       – the underlying <div>, for callers that need addEventListener
//                      or scrollTop access
//
// itemHeight(index) is called synchronously; heights are NOT cached here.
// Callers are expected to keep their own pre-computed height data.

export interface VirtualListHandle {
  scrollTo(index: number): void;
  readonly domElement: HTMLDivElement | null;
}

export interface VirtualListProps {
  length: number;
  itemHeight: (index: number) => number;
  renderItem: (index: number, key: number) => React.ReactNode;
  overscan?: number;
  className?: string;
  style?: React.CSSProperties;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}

// Sum itemHeight from 0 (inclusive) to endIndex (exclusive).
function sumHeights(itemHeight: (i: number) => number, endIndex: number): number {
  let total = 0;
  for (let i = 0; i < endIndex; i++) total += itemHeight(i);
  return total;
}

const VirtualList = forwardRef<VirtualListHandle, VirtualListProps>((props, ref) => {
  const {
    length,
    itemHeight,
    renderItem,
    overscan = 3,
    className,
    style,
    onScroll,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Track container height via ResizeObserver so we re-render when it resizes.
  const observerRef = useRef<ResizeObserver | null>(null);
  const containerCallbackRef = (el: HTMLDivElement | null): void => {
    // containerRef is set by React's own ref forwarding; we need a callback
    // ref for the ResizeObserver.
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    if (!el) return;
    observerRef.current = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      setContainerHeight(h);
    });
    observerRef.current.observe(el);
    setContainerHeight(el.clientHeight);
  };

  useImperativeHandle(ref, () => ({
    scrollTo(index: number): void {
      const el = containerRef.current;
      if (!el) return;
      const offset = sumHeights(itemHeight, index);
      el.scrollTop = offset;
      // Update internal scrollTop immediately so visible range is correct
      // before the scroll event fires.
      setScrollTop(offset);
    },
    get domElement(): HTMLDivElement | null {
      return containerRef.current;
    },
  }), [itemHeight]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    setScrollTop(e.currentTarget.scrollTop);
    onScroll?.(e);
  };

  if (length === 0) {
    return (
      <div
        ref={containerCallbackRef}
        className={className}
        style={{ overflow: 'auto', ...style }}
        onScroll={handleScroll}
      />
    );
  }

  // Find first visible item: the last item whose top edge is <= scrollTop.
  let firstVisible = 0;
  let accumulated = 0;
  while (firstVisible < length - 1) {
    const h = itemHeight(firstVisible);
    if (accumulated + h > scrollTop) break;
    accumulated += h;
    firstVisible++;
  }

  // Find last visible item: first item whose top edge is >= scrollTop + containerHeight.
  let lastVisible = firstVisible;
  let accFromFirst = accumulated;
  while (lastVisible < length - 1 && accFromFirst < scrollTop + containerHeight) {
    accFromFirst += itemHeight(lastVisible);
    lastVisible++;
  }

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(length - 1, lastVisible + overscan);

  const topSpacer = sumHeights(itemHeight, startIndex);
  const bottomSpacer = sumHeights(itemHeight, length) - sumHeights(itemHeight, endIndex + 1);

  const items: React.ReactNode[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    items.push(renderItem(i, i));
  }

  return (
    <div
      ref={containerCallbackRef}
      className={className}
      style={{ overflow: 'auto', ...style }}
      onScroll={handleScroll}
    >
      {topSpacer > 0 && <div style={{ height: topSpacer }} />}
      {items}
      {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} />}
    </div>
  );
});

VirtualList.displayName = 'VirtualList';

export default VirtualList;
