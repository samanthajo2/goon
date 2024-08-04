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

// it seems like these should be auto generated, actions should
// get registered but that's easier said than done.
//
// 1. The actions exist in another process
//
// 2. The actions don't exist until the view for them exist
//    so for example no viewer = no viewer actions registered

const actions = {
  noop:               { hint: '',                icon: 'noop.svg',            desc: 'do nothing', },
  newCollection:      { hint: 'new collection',  icon: 'new-collection.svg',  desc: 'create a new collection', },
  editCollection:     { hint: 'edit collection', icon: 'edit-collection.svg', desc: 'edit collection', },
  closeViewer:        { hint: 'close',           icon: 'close.svg',           desc: 'close the viewer', },
  zoomIn:             { hint: 'zoom in',         icon: 'zoomin.svg',          desc: 'zoom in', },
  zoomOut:            { hint: 'zoom out',        icon: 'zoomout.svg',         desc: 'zoom out', },
  setLoop:            { hint: 'loop',            icon: 'loop.svg',            desc: '1st = set start, 2nd = set end, 3rd = clear', },
  view:               { hint: 'view',            icon: '???.svg',             desc: 'view current selection', },
  gotoPrev:           { hint: 'next',            icon: 'prev.svg',            desc: 'go to next item', },
  gotoNext:           { hint: 'prev',            icon: 'next.svg',            desc: 'go ot previous item', },
  togglePlay:         { hint: 'play',            icon: 'play.svg',            desc: 'play - pause', },
  fastForward:        { hint: 'ff',              icon: 'ff.svg',              desc: 'step forward', },
  fastBackward:       { hint: 'rew',             icon: 'rew.svg',             desc: 'step backward', },
  scrollUp:           { hint: '',                icon: 'up.svg',              desc: 'TBD', },
  scrollDown:         { hint: '',                icon: 'down.svg',            desc: 'TBD', },
  setPlaybackSpeed1:  { hint: '1x',              icon: '1x.svg',              desc: 'playback speed 1x', },
  setPlaybackSpeed2:  { hint: '.66x',            icon: '0.66x.svg',           desc: 'playback speed .66x', },
  setPlaybackSpeed3:  { hint: '.5x',             icon: '0.5x.svg',            desc: 'playback speed .5x', },
  setPlaybackSpeed4:  { hint: '.33x',            icon: '0.33x.svg',           desc: 'playback speed .33x', },
  setPlaybackSpeed5:  { hint: '.25x',            icon: '0.25x.svg',           desc: 'playback speed .25x', },
  cyclePlaybackSpeed: { hint: 'cycle speed',     icon: 'speed.svg',           desc: 'cycle playback speed', },
  toggleSlideshow:    { hint: 'slideshow',       icon: 'slideshow.svg',       desc: 'start/stop slideshow', },
  rotate:             { hint: 'rotate',          icon: 'rotate.svg',          desc: 'rotate item', },
  changeStretchMode:  { hint: 'zoom mode',       icon: 'stretch-both.svg',    desc: 'change stretch mode', },
  nextView:           { hint: 'next view',       icon: 'prev-view.svg',       desc: 'switch to next view', },
  prevView:           { hint: 'prev view',       icon: 'next-view.svg',       desc: 'switch to previous view', },
  toggleUI:           { hint: 'ui',              icon: 'ui.svg',              desc: 'toggle toolbar, folder list', },
  splitHorizontal:    { hint: 'split h',         icon: 'split-h.svg',         desc: 'split current view horizontally', },
  splitHorizontalAlt: { hint: 'split h alt',     icon: 'split-h.svg',         desc: 'split current view horizontally alt', },
  splitVertical:      { hint: 'split v',         icon: 'split-v.svg',         desc: 'split current view vertically', },
  splitVerticalAlt:   { hint: 'split v alt',     icon: 'split-v.svg',         desc: 'split current view vertically alt', },
  deletePane:         { hint: 'del pane',        icon: 'delpane.svg',         desc: 'delete current view', },
  showHelp:           { hint: 'help',            icon: 'help.svg',            desc: 'show help', },
  cycleGridMode:      { hint: 'layout',          icon: 'columns.svg',         desc: 'change grid layout mode', },
  cycleSortMode:      { hint: 'sort mode',       icon: 'sort-by-path.svg',    desc: 'change sort mode', },
  toggleFullscreen:   { hint: 'fullscreen',      icon: '???.svg',             desc: 'toggle fullscreen', },
  newWindow:          { hint: 'new window',      icon: '???.svg',             desc: 'open a new window', },
};
Object.values(actions).forEach((a) => { a.icon = `images/buttons/${a.icon}`; });

function makeActionFuncs(emitFn) {
  const funcs = {};
  Object.keys(actions).forEach((actionId) => {
    funcs[actionId] = () => {
      emitFn({action: actionId});
    };
  });
  return funcs;
}

export {
  actions,
  makeActionFuncs,
};
