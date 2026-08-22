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

import hjson from 'hjson';
import { ActionId } from '../../lib/actions.js';
import { cloneDeep } from '../../lib/utils.js';

// An Electron-style accelerator string, e.g. 'F6', 'CommandOrControl+A',
// 'Cmd+Shift+Z', 'Tab'. See https://www.electronjs.org/docs/api/accelerator
export type KeyConfig = {
  accelerator: string,
  action: ActionId,
};

export type ToolbarPosition = 'top' | 'bottom' | 'swapTop' | 'swapBottom';

export type Preferences = {
  version: number,
  folders: string[],
  thumbnails: {
    scanSize: number,
  },
  misc: {
    stepForwardDuration: number,
    stepBackwardDuration: number,
    fullPathOnSeparator: boolean,
    indentByFolderDepth: boolean,
    gaplessDividers: boolean,
    scanContinuously: boolean,
    showThumber: boolean,
    showBad: boolean,
    filterSmallImages: boolean,
    toolbarPosition: ToolbarPosition,
    password: string,
    checkForUpdates: boolean,
    showDates: boolean,
    showDimensions: boolean,
    promptOnDeleteFile: boolean,
    promptOnDeleteFolder: boolean,
    promptOnDragDrop: boolean,
    enableWeb: boolean,
    // oops!
    enableRendevous: boolean,
    showEmpty: boolean,
    // When true, the Folders sidebar shows empty parent folders if they
    // have at least one non-empty descendant. Clicking such a virtual
    // entry scrolls the image grid to its first non-empty descendant.
    // Has no effect on the image grid itself.
    showEmptyIfChildNotEmpty: boolean,
    // Briefly flash a "recorded in Goon" watermark into recordings when they start.
    showCaptureWatermark: boolean,
    externalViewerPath: string,
  },
  slideshowDuration: {
    image: number,
    'image/gif': number,
    video: number,
    default: number,
  },
  keyConfig: KeyConfig[],
};

const s_prefsVersion = 3;

const defaultPrefs: Preferences = {
  version: s_prefsVersion,
  folders: [],
  thumbnails: {
    scanSize: 150,
  },
  misc: {
    stepForwardDuration: 10,
    stepBackwardDuration: 5,
    fullPathOnSeparator: true,
    indentByFolderDepth: true,
    gaplessDividers: false,
    scanContinuously: true,
    showThumber: true,
    showBad: false,
    filterSmallImages: true,
    toolbarPosition: 'swapBottom',
    password: '',
    checkForUpdates: true,
    showDates: false,
    showDimensions: false,
    promptOnDeleteFile: true,
    promptOnDeleteFolder: true,
    promptOnDragDrop: true,
    enableWeb: false,
    enableRendevous: true,
    showEmpty: false,
    showEmptyIfChildNotEmpty: true,
    showCaptureWatermark: false,
    externalViewerPath: '',
  },
  slideshowDuration: {
    'image': 5,
    'image/gif': 10,
    'video': 30,
    // note: this is not currently used.
    // The idea is if new formats were added via plugins
    // they'd get this duration by default.
    'default': 5,
  },
  keyConfig: [
    { accelerator: 'Escape',                  action: 'closeViewer' },
    { accelerator: 'F1',                      action: 'zoomIn' },
    { accelerator: 'F2',                      action: 'zoomOut' },
    { accelerator: 'R',                       action: 'resetZoom' },
    // Browser-style zoom of the focused viewer (Cmd on macOS, Ctrl elsewhere).
    // '=' also covers '+' (Shift+=) via the explicit Shift binding below.
    { accelerator: 'CommandOrControl+=',      action: 'zoomIn' },
    { accelerator: 'CommandOrControl+Shift+=', action: 'zoomIn' },
    { accelerator: 'CommandOrControl+-',      action: 'zoomOut' },
    { accelerator: 'CommandOrControl+0',      action: 'resetZoom' },
    { accelerator: 'L',                       action: 'setLoop' },
    { accelerator: 'Shift',                   action: 'gotoPrev' },
    { accelerator: '[',                       action: 'gotoPrev' },
    { accelerator: 'Control',                 action: 'gotoNext' },
    { accelerator: ']',                       action: 'gotoNext' },
    { accelerator: '\\',                      action: 'gotoNext' },
    { accelerator: 'P',                       action: 'togglePlay' },
    { accelerator: 'Tab',                     action: 'fastForward' },
    { accelerator: 'Q',                       action: 'fastForward' },
    { accelerator: 'Right',                   action: 'fastForward' },
    { accelerator: 'Left',                    action: 'fastBackward' },
    { accelerator: '`',                       action: 'fastBackward' },
    { accelerator: 'W',                       action: 'fastBackward' },
    { accelerator: 'Up',                      action: 'scrollUp' },
    { accelerator: 'Down',                    action: 'scrollDown' },
    { accelerator: '1',                       action: 'setPlaybackSpeed1' },
    { accelerator: '2',                       action: 'setPlaybackSpeed2' },
    { accelerator: '3',                       action: 'setPlaybackSpeed3' },
    { accelerator: '4',                       action: 'setPlaybackSpeed4' },
    { accelerator: '5',                       action: 'setPlaybackSpeed5' },
    { accelerator: 'S',                       action: 'toggleSlideshow' },
    { accelerator: '/',                       action: 'rotate' },
    { accelerator: 'A',                       action: 'rotate' },
    { accelerator: 'X',                       action: 'rotate' },
    { accelerator: '.',                       action: 'changeStretchMode' },
    { accelerator: 'Z',                       action: 'changeStretchMode' },
    { accelerator: 'F3',                      action: 'nextView' },
    { accelerator: 'F4',                      action: 'prevView' },
    { accelerator: 'F5',                      action: 'toggleUI' },
    { accelerator: '6',                       action: 'splitHorizontal' },
    { accelerator: '7',                       action: 'splitVertical' },
    { accelerator: '8',                       action: 'deletePane' },
    { accelerator: 'F11',                     action: 'toggleFullscreen' },
    { accelerator: 'CommandOrControl+N',      action: 'newWindow' },
    { accelerator: 'CommandOrControl+A',      action: 'selectAll' },
    { accelerator: 'CommandOrControl+D',      action: 'clearSelection' },
  ],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyDefaults<T extends Record<string, any>>(dst: T, defaults: T): void {
  for (const [key, value] of Object.entries(defaults)) {
    const k = key as keyof T;
    if (typeof dst[k] === 'undefined') {
      dst[k] = value;
    }
  }
}

function getPrefs(prefs: Preferences) {
  if (!prefs) {
    return cloneDeep(defaultPrefs);
  }

  // add in missing prefs (if prefs is old)
  prefs = cloneDeep(prefs);
  for (const [topKey, topValue] of Object.entries(defaultPrefs)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const midPrefs = (prefs as any)[topKey];
    if (!midPrefs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prefs as any)[topKey] = cloneDeep(topValue);
    } else if (!Array.isArray(topValue)) {
      for (const [midKey, midValue] of Object.entries(topValue)) {
        if (midPrefs[midKey] === undefined) {
          midPrefs[midKey] = midValue;
        }
      }
    }
  }

  return prefs;
}

function assert(cond: boolean, ...msg: string[]) {
  if (!cond) {
    throw new Error([...msg].join(' '));
  }
}

function convertVersion0To1OrThrow(prefs: Preferences): Preferences {
  assert(prefs.version === undefined);
  applyDefaults(prefs, defaultPrefs);
  applyDefaults(prefs.misc, defaultPrefs.misc);
  prefs.version = 1;
  return prefs;
}

function convertVersion1To2OrThrow(prefs: Preferences): Preferences {
  assert(prefs.version === 1);
  applyDefaults(prefs, defaultPrefs);
  applyDefaults(prefs.misc, defaultPrefs.misc);
  prefs.misc.toolbarPosition = (prefs.misc as unknown as {toolbarOnBottom: boolean}).toolbarOnBottom ? 'bottom' : 'top';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (prefs as any).toolbarOnBottom;
  prefs.version = 2;
  return prefs;
}

// v3: keyConfig switched from {keyCode, modifiers} to {accelerator}. Old
// entries can't be auto-translated, so reset keyConfig to defaults.
function convertVersion2To3OrThrow(prefs: Preferences): Preferences {
  assert(prefs.version === 2);
  applyDefaults(prefs, defaultPrefs);
  applyDefaults(prefs.misc, defaultPrefs.misc);
  prefs.keyConfig = cloneDeep(defaultPrefs.keyConfig);
  prefs.version = 3;
  return prefs;
}


const versionConverters = new Map<number, (prefs: Preferences) => Preferences>([
  [0, convertVersion0To1OrThrow],
  [1, convertVersion1To2OrThrow],
  [2, convertVersion2To3OrThrow],
]);

function loadPrefs(prefsPath: string, fs: {
  existsSync: (filename: string) => boolean,
  readUTF8FileSync: (filename: string) => string,
}) {
  let error;
  let prefs = cloneDeep<Preferences>(defaultPrefs);
  if (fs.existsSync(prefsPath)) {
    try {
      const str = fs.readUTF8FileSync(prefsPath) as string;
      prefs = hjson.parse(str) as Preferences;
      while (prefs.version !== s_prefsVersion) {
        const converter = versionConverters.get(prefs.version ?? 0);
        if (!converter) {
          throw new Error('bad version');
        }
        prefs = converter(prefs);
      }
    } catch (e) {
      console.error('could not load prefs:', prefsPath, e);
      error = true;
    }
  }
  return {
    error,
    prefs: getPrefs(prefs),
  };
}

export {
  defaultPrefs,
  getPrefs,
  loadPrefs,
};
