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

import keycode from 'keycode';

function getMods(e) {
  const alt   = (e.altKey   ? 'a' : '');
  const ctrl  = (e.ctrlKey  ? 'c' : '');
  const shift = (e.shiftKey ? 's' : '');
  const meta  = (e.metaKey  ? 'm' : '');
  return `${alt}${ctrl}${meta}${shift}`;
}

function prepMods(mods) {
  const chars = Array.prototype.map.call(mods.toLowerCase(), (c) => c);
  chars.sort();
  return chars.join('');
}

/**
 * Routes keys based on keycode and modifier
 */
export default class KeyRouter {
  constructor() {
    this.keyToAction = {};
  }
  /**
   * gets a key
   * @param {Event} e the key event
   * @return {ActionInfo}
   */
  getActionForKey(e) {
    const keyId = `${e.keyCode}:${getMods(e)}`;
    return this.keyToAction[keyId];
  }

  /**
   * @param {number} keyCode the keycode
   * @param {string} [mods] the modifiers where
   *   's' = shift, 'c' = ctrl, 'a' = alt, 'm' = meta (apple key, windows key)
   * @param {function(Event}) handler the funciton to call when key is pressed
   */
  registerKeys(keyConfig) {
    this.keyToAction = {};
    keyConfig.forEach((key) => {
      const keyCode = key.keyCode;
      const mods = key.modifiers || '';
      const keyId = `${keyCode}:${prepMods(mods)}`;
      this.keyToAction[keyId] = key;
    });
  }
}

function keyInfoToId(keyInfo) {
  return keyInfo.keyCode.toString() + keyInfo.modifiers || '';
}

const meta = process.platform.startsWith('win')
  ? 'win'
  : process.platform === 'darwin'
    ? '⌘'
    : 'meta';

function modifiersToString(mods) {
  const parts = [];
  if (mods) {
    if (mods.indexOf('c') >= 0) {
      parts.push('ctrl');
    }
    if (mods.indexOf('a') >= 0) {
      parts.push('alt');
    }
    if (mods.indexOf('s') >= 0) {
      parts.push('shift');
    }
    if (mods.indexOf('m') >= 0) {
      parts.push(meta);
    }
  }
  return parts;
}

function keyInfoToString(keyInfo) {
  const mods = modifiersToString(keyInfo.modifiers);
  const key = keycode(keyInfo.keyCode) || `0x${keyInfo.keyCode.toString(16)}`;
  if (mods.indexOf(key) < 0) {
    mods.push(key);
  }
  return mods.join('+');
}

function eventToKeyInfo(event) {
  return {
    keyCode: event.keyCode,
    modifiers: getMods(event),
  };
}

export {
  eventToKeyInfo,
  keyInfoToId,
  keyInfoToString,
};
