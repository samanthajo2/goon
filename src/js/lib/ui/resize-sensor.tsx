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

// Drop-in replacement for <Measure client onResize={...}> from react-measure.
// Attach the supplied measureRef to whichever DOM element you want observed;
// onResize fires whenever its content box changes.
//
// The contentRect shape intentionally mirrors react-measure's so callers can
// use contentRect.client.width / contentRect.client.height without changes.

export type ClientContentRect = {
  client: { width: number; height: number };
};

type ResizeSensorProps = {
  onResize: (contentRect: ClientContentRect) => void;
  children: (args: { measureRef: (el: Element | null) => void }) => React.ReactNode;
};

export default class ResizeSensor extends React.Component<ResizeSensorProps> {
  private _observer: ResizeObserver | null = null;

  private _measureRef = (el: Element | null): void => {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    if (!el) return;

    this._observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      this.props.onResize({ client: { width, height } });
    });
    this._observer.observe(el);
  };

  componentWillUnmount(): void {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  }

  render(): React.ReactNode {
    return this.props.children({ measureRef: this._measureRef });
  }
}
