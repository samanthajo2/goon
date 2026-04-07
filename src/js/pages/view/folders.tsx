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
import path from 'path';
import { getRotatedXY } from '../../lib/rotatehelper';
import ForwardableEvent from '../../lib/forwardable-event';
import ForwardableEventDispatcher from '../../lib/forwardable-event-dispatcher';
import type { AppEventMap } from './app-event-map';
import { cssArray } from '../../lib/css-utils';
import { Preferences } from '../prefs/default-prefs';
import { FolderStateRoot, FolderStateFolder } from './folder-state-helper';

const s_depthCache: Record<number, string> = {};

function depthPrefix(depth: number): string {
  depth = Math.max(0, depth);
  let prefix = s_depthCache[depth];
  if (!prefix) {
    prefix = (new Array(depth)).fill(0).map(() => '  ').join('');
    s_depthCache[depth] = prefix;
  }
  return prefix;
}

function depthPrefixedFilename(baseFolders: string[], filename: string): string {
  for (const baseFolder of baseFolders) {
    if (filename.startsWith(baseFolder)) {
      filename = filename.substring(path.dirname(baseFolder).length + (baseFolder.startsWith('\\\\') ? 0 : 1));
      break;
    }
  }
  const depth = filename.split(/\\|\//).length;
  return `${depthPrefix(depth - 1)}${path.basename(filename)}`;
}

type FolderProps = {
  eventBus: ForwardableEventDispatcher<AppEventMap>;
  folder: FolderStateFolder;
  count: number;
  folderCount: number;
  numFiles: number;
  prefs: Preferences;
};

class Folder extends React.Component<FolderProps> {
  private _ref = React.createRef<HTMLDivElement>();

  private _handleClick = (): void => {
    this.props.eventBus.dispatch(new ForwardableEvent('goToImage'), this.props.count, this.props.folderCount);
  };

  private _handleContextMenu = (event: React.MouseEvent): void => {
    this.props.eventBus.dispatch(new ForwardableEvent('folderContextMenu', event.nativeEvent), this.props.folder);
  };

  scrollIntoView(): void {
    this._ref.current?.scrollIntoView({
      behavior: 'auto',
      block: 'center',
      inline: 'center',
    });
  }

  render(): React.ReactNode {
    const { folder, prefs } = this.props;
    const name = prefs.misc.indentByFolderDepth
      ? depthPrefixedFilename(prefs.folders, folder.filename)
      : folder.name;
    const classes = cssArray(
      'folder',
      folder.scanning ? 'scanning' : undefined,
      folder.checking ? 'checking' : undefined,
    );
    return (
      <div
        className={classes.toString()}
        onClick={this._handleClick}
        onContextMenu={this._handleContextMenu}
      >
        <div ref={this._ref}>{name} ({this.props.numFiles})</div>
      </div>
    );
  }
}

type Props = {
  root: FolderStateRoot;
  eventBus: ForwardableEventDispatcher<AppEventMap>;
  prefs: Preferences;
  show: boolean;
  rotateMode: number;
};

export default class Folders extends React.Component<Props> {
  private _filenameToRef = new Map<string, React.RefObject<Folder>>();
  private main!: HTMLDivElement;

  constructor(props: Props) {
    super(props);
    this.props.eventBus.on('scrollFolderViewToFile', this._handleScrollFolderToViewFile);
  }

  componentDidMount(): void {
    this.main.addEventListener('wheel', this._handleWheel as EventListener, { passive: false });
  }

  componentWillUnmount(): void {
    this.main.removeEventListener('wheel', this._handleWheel as EventListener);
  }

  private _handleScrollFolderToViewFile = (_event: unknown, folderName: string): void => {
    const ref = this._filenameToRef.get(folderName);
    if (ref) {
      ref.current?.scrollIntoView();
    }
  };

  private _handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const pos = getRotatedXY(e, 'delta', this.props.rotateMode);
    this.main.scrollTop += pos.y;
  };

  private renderFolder(root: FolderStateRoot): React.ReactNode[] {
    this._filenameToRef.clear();
    return root.folders.map((folder, ndx) => {
      const id = `folder-${folder.filename}`;
      const numFiles = folder.files.length;
      const ref = React.createRef<Folder>();
      this._filenameToRef.set(folder.filename, ref);
      return (
        <Folder
          key={id}
          ref={ref}
          folder={folder}
          numFiles={numFiles}
          count={ndx}
          folderCount={ndx}
          eventBus={this.props.eventBus}
          prefs={this.props.prefs}
        />
      );
    });
  }

  render(): React.ReactNode {
    const style = { display: this.props.show ? 'block' : 'none' };
    const folders = this.renderFolder(this.props.root);
    return (
      <div ref={(main) => { this.main = main!; }} style={style} className="folders">
        {folders}
      </div>
    );
  }
}
