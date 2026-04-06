/* eslint-disable @typescript-eslint/no-explicit-any */
/*
Copyright 2024 SamanthaJo

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import chalk from 'chalk';

type HSL ={
  h: number;  // hue, 0-1
  s: number;  // saturation, 0-1
  l: number;  // lightness, 0-1
}

let s_colorNdx = 0;
function generateColor(): HSL {
   
  const h = (((s_colorNdx & 0x01) << 5) |
             ((s_colorNdx & 0x02) << 3) |
             ((s_colorNdx & 0x04) << 1) |
             ((s_colorNdx & 0x08) >> 1) |
             ((s_colorNdx & 0x10) >> 3) |
             ((s_colorNdx & 0x20) >> 5)) / 64.0;
  const s   = (s_colorNdx & 0x10) !== 0 ? 0.5 : 1.0;
  const l   = (s_colorNdx & 0x20) !== 0 ? 0.2 : 0.4;
   

  ++s_colorNdx;
  return {
    h: h * 360 | 0,
    s: s * 100 | 0,
    l: l * 100 | 0,
  };
}

function makeCSSColor(hsl: HSL): string {
  return `hsl(${hsl.h},${hsl.s}%,${hsl.l}%)`;
}

const defaultColor = 'color:inherit;';
function makeBrowserLog(color: HSL, name: string) {
  return console.log.bind(console, '%c%s: %c', `color: ${makeCSSColor(color)}`, name, defaultColor);   
}

function makeTerminalLog(color: HSL, name: string) {
  return console.log.bind(console, chalk.hsl(color.h, color.s, color.l)(name));   
}

type LogFunc = (...args: any[]) => void;
export type Logger = LogFunc & {
  getPrefix: () => string;
  id: string;
  throw: (...args: any[]) => never;
  error: (...args: any[]) => void;
}

export default function makeLogFunc(baseName: string, subName?: string): Logger {
  const name = subName !== undefined ? `${baseName}[${subName}]` : baseName;
  const color = generateColor();
  const logger = process.type === 'renderer'
    ? makeBrowserLog(color, name)
    : makeTerminalLog(color, name);
  const l = logger as Logger;
  l.getPrefix = () => name;
  l.id = name;
  l.throw = (...args) => {
    throw new Error(`${name}: ${[...args].join(' ')}`);
  };
  l.error = (...args) => {
    console.error(name, ...args);
  };
  return l;
}
