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
  noop:               { hint: '',                icon: 'images/buttons/noop.svg',            desc: 'Do Nothing', },
  newCollection:      { hint: 'new collection',  icon: 'images/buttons/new-collection.svg',  desc: 'New Collection', },
  editCollection:     { hint: 'edit collection', icon: 'images/buttons/edit-collection.svg', desc: 'Edit Collection', },
  closeViewer:        { hint: 'close',           icon: 'images/buttons/close.svg',           desc: 'Close Viewer', },
  zoomIn:             { hint: 'zoom in',         icon: 'images/buttons/zoomin.svg',          desc: 'Zoom In', },
  zoomOut:            { hint: 'zoom out',        icon: 'images/buttons/zoomout.svg',         desc: 'Zoom Out', },
  resetZoom:          { hint: 'reset zoom',      icon: 'images/buttons/noop.svg',            desc: 'Reset Zoom', },
  setLoop:            { hint: 'loop',            icon: 'images/buttons/loop.svg',            desc: 'Set Loop (1st = start, 2nd = end, 3rd = clear)', },
  view:               { hint: 'view',            icon: 'images/buttons/???.svg',             desc: 'View Current Selection', },
  gotoPrev:           { hint: 'next',            icon: 'images/buttons/prev.svg',            desc: 'Previous Item', },
  gotoNext:           { hint: 'prev',            icon: 'images/buttons/next.svg',            desc: 'Next Item', },
  togglePlay:         { hint: 'play',            icon: 'images/buttons/play.svg',            desc: 'Play / Pause', },
  fastForward:        { hint: 'ff',              icon: 'images/buttons/ff.svg',              desc: 'Step Forward', },
  fastBackward:       { hint: 'rew',             icon: 'images/buttons/rew.svg',             desc: 'Step Backward', },
  scrollUp:           { hint: '',                icon: 'images/buttons/up.svg',              desc: 'Scroll Up', },
  scrollDown:         { hint: '',                icon: 'images/buttons/down.svg',            desc: 'Scroll Down', },
  setPlaybackSpeed1:  { hint: '1x',              icon: 'images/buttons/1x.svg',              desc: 'Playback Speed 1x', },
  setPlaybackSpeed2:  { hint: '.66x',            icon: 'images/buttons/0.66x.svg',           desc: 'Playback Speed .66x', },
  setPlaybackSpeed3:  { hint: '.5x',             icon: 'images/buttons/0.5x.svg',            desc: 'Playback Speed .5x', },
  setPlaybackSpeed4:  { hint: '.33x',            icon: 'images/buttons/0.33x.svg',           desc: 'Playback Speed .33x', },
  setPlaybackSpeed5:  { hint: '.25x',            icon: 'images/buttons/0.25x.svg',           desc: 'Playback Speed .25x', },
  cyclePlaybackSpeed: { hint: 'cycle speed',     icon: 'images/buttons/speed.svg',           desc: 'Cycle Playback Speed', },
  toggleSlideshow:    { hint: 'slideshow',       icon: 'images/buttons/slideshow.svg',       desc: 'Start/Stop Slideshow', },
  rotate:             { hint: 'rotate',          icon: 'images/buttons/rotate.svg',          desc: 'Rotate', },
  changeStretchMode:  { hint: 'zoom mode',       icon: 'images/buttons/stretch-both.svg',    desc: 'Change Stretch Mode', },
  nextView:           { hint: 'next view',       icon: 'images/buttons/prev-view.svg',       desc: 'Next View', },
  prevView:           { hint: 'prev view',       icon: 'images/buttons/next-view.svg',       desc: 'Previous View', },
  toggleUI:           { hint: 'ui',              icon: 'images/buttons/ui.svg',              desc: 'Toggle Toolbar / Folder List', },
  splitHorizontal:    { hint: 'split h',         icon: 'images/buttons/split-h.svg',         desc: 'Split Horizontal', },
  splitHorizontalAlt: { hint: 'split h alt',     icon: 'images/buttons/split-h.svg',         desc: 'Split Horizontal (alt)', },
  splitVertical:      { hint: 'split v',         icon: 'images/buttons/split-v.svg',         desc: 'Split Vertical', },
  splitVerticalAlt:   { hint: 'split v alt',     icon: 'images/buttons/split-v.svg',         desc: 'Split Vertical (alt)', },
  deletePane:         { hint: 'del pane',        icon: 'images/buttons/delpane.svg',         desc: 'Delete Pane', },
  showHelp:           { hint: 'help',            icon: 'images/buttons/help.svg',            desc: 'Show Help', },
  cycleGridMode:      { hint: 'layout',          icon: 'images/buttons/columns.svg',         desc: 'Cycle Grid Mode', },
  cycleSortMode:      { hint: 'sort mode',       icon: 'images/buttons/sort-by-path.svg',    desc: 'Cycle Sort Mode', },
  toggleShowEmptyFolders: { hint: 'empty folders', icon: 'images/buttons/noop.svg',          desc: 'Show Empty Folders', },
  newVirtualFolder:   { hint: 'new virtual folder', icon: 'images/buttons/new-collection.svg', desc: 'New Virtual Folder', },
  toggleRecording:    { hint: 'record',           icon: 'images/buttons/noop.svg',            desc: 'Start/Stop Recording', },
  createNewFolder:    { hint: 'new folder',      icon: 'images/buttons/noop.svg',            desc: 'New Folder', },
  renameFolder:       { hint: 'rename folder',   icon: 'images/buttons/noop.svg',            desc: 'Rename Folder', },
  toggleFullscreen:   { hint: 'fullscreen',      icon: 'images/buttons/???.svg',             desc: 'Toggle Full Screen', },
  newWindow:          { hint: 'new window',      icon: 'images/buttons/???.svg',             desc: 'New Window', },
  playAll:            { hint: 'play all',        icon: 'images/buttons/play-all.svg',        desc: 'Play / Pause All Videos', },
  launchBrowser:      { hint: 'launch browser',  icon: 'images/buttons/browser.svg',         desc: 'Launch Browser', },
  launchExternalViewer: { hint: 'external viewer', icon: 'images/buttons/vr.svg',            desc: 'Open in External Viewer', },
  refreshFolders:     { hint: 'refresh',         icon: 'images/buttons/refresh.svg',         desc: 'Refresh Folders', },
  selectAll:          { hint: 'select all',      icon: 'images/buttons/noop.svg',            desc: 'Select All Visible', },
  clearSelection:     { hint: 'clear selection', icon: 'images/buttons/noop.svg',            desc: 'Clear Selection', },
  trashSelected:      { hint: 'delete selected', icon: 'images/buttons/noop.svg',            desc: 'Delete Selected...', },
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
