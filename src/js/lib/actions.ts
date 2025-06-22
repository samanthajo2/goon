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
  noop:               { hint: '',                icon: 'images/buttons/noop.svg',            desc: 'do nothing', },
  newCollection:      { hint: 'new collection',  icon: 'images/buttons/new-collection.svg',  desc: 'create a new collection', },
  editCollection:     { hint: 'edit collection', icon: 'images/buttons/edit-collection.svg', desc: 'edit collection', },
  closeViewer:        { hint: 'close',           icon: 'images/buttons/close.svg',           desc: 'close the viewer', },
  zoomIn:             { hint: 'zoom in',         icon: 'images/buttons/zoomin.svg',          desc: 'zoom in', },
  zoomOut:            { hint: 'zoom out',        icon: 'images/buttons/zoomout.svg',         desc: 'zoom out', },
  setLoop:            { hint: 'loop',            icon: 'images/buttons/loop.svg',            desc: '1st = set start, 2nd = set end, 3rd = clear', },
  view:               { hint: 'view',            icon: 'images/buttons/???.svg',             desc: 'view current selection', },
  gotoPrev:           { hint: 'next',            icon: 'images/buttons/prev.svg',            desc: 'go to next item', },
  gotoNext:           { hint: 'prev',            icon: 'images/buttons/next.svg',            desc: 'go ot previous item', },
  togglePlay:         { hint: 'play',            icon: 'images/buttons/play.svg',            desc: 'play - pause', },
  fastForward:        { hint: 'ff',              icon: 'images/buttons/ff.svg',              desc: 'step forward', },
  fastBackward:       { hint: 'rew',             icon: 'images/buttons/rew.svg',             desc: 'step backward', },
  scrollUp:           { hint: '',                icon: 'images/buttons/up.svg',              desc: 'TBD', },
  scrollDown:         { hint: '',                icon: 'images/buttons/down.svg',            desc: 'TBD', },
  setPlaybackSpeed1:  { hint: '1x',              icon: 'images/buttons/1x.svg',              desc: 'playback speed 1x', },
  setPlaybackSpeed2:  { hint: '.66x',            icon: 'images/buttons/0.66x.svg',           desc: 'playback speed .66x', },
  setPlaybackSpeed3:  { hint: '.5x',             icon: 'images/buttons/0.5x.svg',            desc: 'playback speed .5x', },
  setPlaybackSpeed4:  { hint: '.33x',            icon: 'images/buttons/0.33x.svg',           desc: 'playback speed .33x', },
  setPlaybackSpeed5:  { hint: '.25x',            icon: 'images/buttons/0.25x.svg',           desc: 'playback speed .25x', },
  cyclePlaybackSpeed: { hint: 'cycle speed',     icon: 'images/buttons/speed.svg',           desc: 'cycle playback speed', },
  toggleSlideshow:    { hint: 'slideshow',       icon: 'images/buttons/slideshow.svg',       desc: 'start/stop slideshow', },
  rotate:             { hint: 'rotate',          icon: 'images/buttons/rotate.svg',          desc: 'rotate item', },
  changeStretchMode:  { hint: 'zoom mode',       icon: 'images/buttons/stretch-both.svg',    desc: 'change stretch mode', },
  nextView:           { hint: 'next view',       icon: 'images/buttons/prev-view.svg',       desc: 'switch to next view', },
  prevView:           { hint: 'prev view',       icon: 'images/buttons/next-view.svg',       desc: 'switch to previous view', },
  toggleUI:           { hint: 'ui',              icon: 'images/buttons/ui.svg',              desc: 'toggle toolbar, folder list', },
  splitHorizontal:    { hint: 'split h',         icon: 'images/buttons/split-h.svg',         desc: 'split current view horizontally', },
  splitHorizontalAlt: { hint: 'split h alt',     icon: 'images/buttons/split-h.svg',         desc: 'split current view horizontally alt', },
  splitVertical:      { hint: 'split v',         icon: 'images/buttons/split-v.svg',         desc: 'split current view vertically', },
  splitVerticalAlt:   { hint: 'split v alt',     icon: 'images/buttons/split-v.svg',         desc: 'split current view vertically alt', },
  deletePane:         { hint: 'del pane',        icon: 'images/buttons/delpane.svg',         desc: 'delete current view', },
  showHelp:           { hint: 'help',            icon: 'images/buttons/help.svg',            desc: 'show help', },
  cycleGridMode:      { hint: 'layout',          icon: 'images/buttons/columns.svg',         desc: 'change grid layout mode', },
  cycleSortMode:      { hint: 'sort mode',       icon: 'images/buttons/sort-by-path.svg',    desc: 'change sort mode', },
  toggleFullscreen:   { hint: 'fullscreen',      icon: 'images/buttons/???.svg',             desc: 'toggle fullscreen', },
  newWindow:          { hint: 'new window',      icon: 'images/buttons/???.svg',             desc: 'open a new window', },
  playAll:            { hint: 'play all',        icon: 'images/buttons/play-all.svg',        desc: 'play/pause all videos', },
} as const;

export type ActionId = keyof typeof actions;
export type Action = {
  action: ActionId;
};

function makeActionFuncs(emitFn: (action: Action) => void) {
  const actionKeys = Object.keys(actions) as ActionId[];
  const funcs: { [key in ActionId]: () => void } = Object.fromEntries(
    actionKeys.map((actionId) => [
      actionId,
      () => { emitFn({ action: actionId }); }
    ])
  ) as { [key in ActionId]: () => void };
  return funcs;
}

export {
  actions,
  makeActionFuncs,
};
