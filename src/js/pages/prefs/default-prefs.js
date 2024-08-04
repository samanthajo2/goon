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

import _ from 'lodash';
import hjson from 'hjson';

const s_prefsVersion = 2;

const defaultPrefs = {
  version: s_prefsVersion,
  folders: [],
  thumbnails: {
    scanSize: 150,
  },
  misc: {
    stepForwardDuration: 10,
    stepBackwardDuration: 5,
    fullPathOnSeparator: true,
    indentByFolderDepth: false,
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
    enableWeb: false,
    enableRendevous: true,
    showEmpty: false,
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
    { keyCode:  27, action: 'closeViewer', },  // esc
    { keyCode: 112, action: 'zoomIn', },  // F1
    { keyCode: 113, action: 'zoomOut', },  // F2
    { keyCode:  76, action: 'setLoop', },
    { keyCode:  16, modifiers: 's', action: 'gotoPrev', }, // left-shift
    { keyCode: 219, action: 'gotoPrev', },  // [
    { keyCode:  17, modifiers: 'c', action: 'gotoNext', },  // left control
    { keyCode: 221, action: 'gotoNext', },  // ]
    { keyCode: 220, action: 'gotoNext', },  // \|
    { keyCode:  80, action: 'togglePlay', }, // p
    { keyCode:   9, action: 'fastForward', },   // tab
    { keyCode:  81, action: 'fastForward', },   // q
    { keyCode:  39, action: 'fastForward', },   // right
    { keyCode:  37, action: 'fastBackward', },  // left
    { keyCode: 192, action: 'fastBackward', },  // tilda
    { keyCode:  87, action: 'fastBackward', },  // w
    { keyCode:  38, action: 'scrollUp', },  // up
    { keyCode:  40, action: 'scrollDown', },  // down
    { keyCode:  49, action: 'setPlaybackSpeed1', },  // 1  1
    { keyCode:  50, action: 'setPlaybackSpeed2', },  // 2  0.66
    { keyCode:  51, action: 'setPlaybackSpeed3', },  // 3  0.5
    { keyCode:  52, action: 'setPlaybackSpeed4', },  // 4  0.33
    { keyCode:  53, action: 'setPlaybackSpeed5', },  // 5  0.25
    { keyCode:  83, action: 'toggleSlideshow', }, // S
    { keyCode: 191, action: 'rotate', },  // /  rotate
    { keyCode:  65, action: 'rotate', },  // a  rotate
    { keyCode:  88, action: 'rotate', },  // x  rotate
    { keyCode: 190, action: 'changeStretchMode', },  // . stretch
    { keyCode:  90, action: 'changeStretchMode', },  // z stretch
    { keyCode: 114, action: 'nextView', },  // F3
    { keyCode: 115, action: 'prevView', },  // F4
    { keyCode: 116, action: 'toggleUI', },  // F5
    { keyCode:  54, action: 'splitHorizontal', },  // F6
    { keyCode:  55, action: 'splitVertical', },  // F7
    { keyCode:  56, action: 'deletePane', },  // F8
    { keyCode: 122, action: 'toggleFullscreen', }, // F11
    { keyCode:  78, modifiers: 'm', action: 'newWindow', } // Cmd-M
  ],
};

function getPrefs(prefs) {
  if (!prefs) {
    return _.cloneDeep(defaultPrefs);
  }

  // add in missing prefs (if prefs is old)
  prefs = _.cloneDeep(prefs);
  for (const [topKey, topValue] of Object.entries(defaultPrefs)) {
    const midPrefs = prefs[topKey];
    if (!midPrefs) {
      prefs[topKey] = _.cloneDeep(topValue);
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

function assert(cond, ...msg) {
  if (!cond) {
    throw new Error([...msg].join(' '));
  }
}

function convertVersion0To1OrThrow(prefs) {
  assert(prefs.version === undefined);
  _.defaults(prefs, defaultPrefs);
  _.defaults(prefs.misc, defaultPrefs.misc);
  prefs.version = 1;
  return prefs;
}

function convertVersion1To2OrThrow(prefs) {
  assert(prefs.version === 1);
  _.defaults(prefs, defaultPrefs);
  _.defaults(prefs.misc, defaultPrefs.misc);
  prefs.misc.toolbarPosition = prefs.misc.toolbarOnBottom ? 'bottom' : 'top';
  delete prefs.toolbarOnBottom;
  prefs.version = 2;
  return prefs;
}


const versionConverters = {
  '0': convertVersion0To1OrThrow,
  '1': convertVersion1To2OrThrow,
};

function loadPrefs(prefsPath, fs) {
  let error;
  let prefs;
  if (fs.existsSync(prefsPath)) {
    try {
      const str = fs.readFileSync(prefsPath, {encoding: 'utf8'});
      prefs = hjson.parse(str);
      while (prefs.version !== s_prefsVersion) {
        const converter = versionConverters[prefs.version || 0];
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
