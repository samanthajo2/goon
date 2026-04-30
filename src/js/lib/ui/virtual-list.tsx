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

import React, { useImperativeHandle, useMemo, useRef, useState } from 'react';

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
// Heights are passed as a precomputed array so this component can build
// prefix sums once per heights-array change and use binary search for
// visible-range and spacer computations on every scroll event.

export interface VirtualListHandle {
  scrollTo(index: number): void;
  readonly domElement: HTMLDivElement | null;
}

export interface VirtualListProps {
  itemHeights: number[];
  renderItem: (index: number, key: number) => React.ReactNode;
  overscan?: number;
  className?: string;
  style?: React.CSSProperties;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}

function VirtualList(props: VirtualListProps & { ref?: React.Ref<VirtualListHandle> }): React.ReactNode {
  const {
    itemHeights,
    renderItem,
    overscan = 3,
    className,
    style,
    onScroll,
    ref,
  } = props;
  const length = itemHeights.length;

  // Cumulative heights; prefixSums[i] = sum of itemHeights[0..i-1], so
  // prefixSums[i] is the y-offset of item i's top edge and prefixSums[length]
  // is the total height. Rebuilt only when the heights array reference
  // changes — scroll-driven re-renders re-use the same memoized array.
  const prefixSums = useMemo(() => {
    const sums = new Array<number>(length + 1);
    sums[0] = 0;
    for (let i = 0; i < length; i++) sums[i + 1] = sums[i] + itemHeights[i];
    return sums;
  }, [itemHeights, length]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  // Cached visible-range cursors. Scrolling normally moves these by 0–1
  // items per frame, so the loops below are O(1) in the common case.
  const firstVisibleRef = useRef(0);
  const lastVisibleRef = useRef(0);
  // Reset cursors when the heights array (and thus prefixSums identity)
  // changes — items may have been added/removed/resized.
  const lastSumsRef = useRef(prefixSums);
  if (lastSumsRef.current !== prefixSums) {
    lastSumsRef.current = prefixSums;
    if (firstVisibleRef.current >= length) firstVisibleRef.current = Math.max(0, length - 1);
    if (lastVisibleRef.current >= length) lastVisibleRef.current = Math.max(0, length - 1);
  }

  // Track container height via ResizeObserver so we re-render when it resizes.
  const observerRef = useRef<ResizeObserver | null>(null);
  const containerCallbackRef = (el: HTMLDivElement | null): void => {
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
      const offset = prefixSums[Math.max(0, Math.min(index, length))];
      el.scrollTop = offset;
      setScrollTop(offset);
    },
    get domElement(): HTMLDivElement | null {
      return containerRef.current;
    },
  }), [prefixSums, length]);

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

  // Incremental visible-range update. We know where the visible window
  // *was*; nudge the cursors to where it is now. For typical wheel/touch
  // scroll deltas this is O(1) per frame; only big scrollbar jumps walk
  // a non-trivial number of steps, and that's still O(distance / itemH),
  // not O(N).
  let firstVisible = firstVisibleRef.current;
  // Move forward while item below `firstVisible` has scrolled out of view.
  while (firstVisible < length - 1 && prefixSums[firstVisible + 1] <= scrollTop) firstVisible++;
  // Move backward if we've scrolled up past the top of the cached cursor.
  while (firstVisible > 0 && prefixSums[firstVisible] > scrollTop) firstVisible--;

  let lastVisible = lastVisibleRef.current;
  if (lastVisible < firstVisible) lastVisible = firstVisible;
  const bottom = scrollTop + containerHeight;
  while (lastVisible < length - 1 && prefixSums[lastVisible + 1] < bottom) lastVisible++;
  while (lastVisible > firstVisible && prefixSums[lastVisible] >= bottom) lastVisible--;

  firstVisibleRef.current = firstVisible;
  lastVisibleRef.current = lastVisible;

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(length - 1, lastVisible + overscan);

  const topSpacer = prefixSums[startIndex];
  const bottomSpacer = prefixSums[length] - prefixSums[endIndex + 1];

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
}

export default VirtualList;
