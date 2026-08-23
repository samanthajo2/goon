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
import * as path from '../../lib/path-helpers.js';
import { getRotatedXY } from '../../lib/rotatehelper.js';
import ForwardableEvent from '../../lib/forwardable-event.js';
import { cssArray } from '../../lib/css-utils.js';
import { isVirtualFolderKey } from '../thumber/virtual-folder-key.js';
import { getDragContext } from './drag-context.js';
import { FolderStateRoot, FolderStateFolder } from './folder-state-helper.js';
import { AppContext } from './contexts.js';

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

// Resolve which watched root a folder lives under (returning the dirname
// of that root, so the watched folder itself is the first visible level).
function baseDirFn(baseFolders: string[]): (filename: string) => string {
  return (filename: string): string => {
    for (const baseFolder of baseFolders) {
      if (filename.startsWith(baseFolder)) {
        return path.dirname(baseFolder);
      }
    }
    return '';
  };
}

// Compute display names that collapse empty parent folders.
// E.g. if "animals" has files and "animals/dogs/shepherds" has files
// but "animals/dogs" does NOT, we display "dogs/shepherds" indented under "animals".
export function computeIndentedNames(baseFolders: string[], filenames: string[]): string[] {
  const visiblePaths = new Set(filenames);
  const baseDir = baseDirFn(baseFolders);

  return filenames.map(filename => {
    const base = baseDir(filename);

    // Walk up from folder to base, collecting parent paths. Guard against
    // path.dirname reaching a fixed point (e.g. '.') so a non-path key like a
    // virtual folder's `vfolder:<id>` can't spin forever.
    const parents: string[] = [];
    let p = path.dirname(filename);
    while (p.length > base.length) {
      parents.unshift(p);
      const next = path.dirname(p);
      if (next === p) break;
      p = next;
    }

    // Find the deepest visible ancestor
    let ancestorIdx = -1;
    for (let i = 0; i < parents.length; i++) {
      if (visiblePaths.has(parents[i])) {
        ancestorIdx = i;
      }
    }

    // Build display name from the path after the deepest visible ancestor
    const startPath = ancestorIdx >= 0 ? parents[ancestorIdx] : base;
    let relative = filename.substring(startPath.length);
    // Strip leading separator (POSIX or Windows).
    if (relative.startsWith('/') || relative.startsWith('\\')) {
      relative = relative.substring(1);
    }
    const indent = ancestorIdx + 1;
    return `${depthPrefix(indent)}${relative}`;
  });
}

// One row in the rendered Folders sidebar — either a real non-empty
// folder or a virtual empty ancestor synthesized when the
// `showEmptyIfChildNotEmpty` pref is on. Virtual entries reuse the
// `realFolderNdx` of their first non-empty descendant so a click still
// dispatches a valid goToImage.
type FolderEntry = {
  filename: string;
  // Display name (used directly for virtual folders, whose key isn't a real path).
  name: string;
  numFiles: number;
  realFolder?: FolderStateFolder;
  realFolderNdx: number;
  scanning: boolean;
  checking: boolean;
};

export function buildFolderEntries(
  baseFolders: string[],
  realFolders: FolderStateFolder[],
  withVirtualAncestors: boolean,
): FolderEntry[] {
  const realEntries: FolderEntry[] = realFolders.map((folder, ndx) => ({
    filename: folder.filename,
    name: folder.name,
    numFiles: folder.files.length,
    realFolder: folder,
    realFolderNdx: ndx,
    scanning: !!folder.scanning,
    checking: !!folder.checking,
  }));
  if (!withVirtualAncestors) return realEntries;

  const baseDir = baseDirFn(baseFolders);
  const result: FolderEntry[] = [];
  const emitted = new Set<string>();
  realEntries.forEach((entry) => {
    // Virtual folders are flat top-level entries — they have no real-path ancestors.
    if (isVirtualFolderKey(entry.filename)) {
      if (!emitted.has(entry.filename)) {
        emitted.add(entry.filename);
        result.push(entry);
      }
      return;
    }
    const base = baseDir(entry.filename);
    // Collect ancestor paths between base (exclusive) and folder (exclusive). Guard
    // against path.dirname reaching a fixed point (defensive; see computeIndentedNames).
    const ancestors: string[] = [];
    let p = path.dirname(entry.filename);
    while (p.length > base.length) {
      ancestors.unshift(p);
      const next = path.dirname(p);
      if (next === p) break;
      p = next;
    }
    for (const ancestor of ancestors) {
      if (!emitted.has(ancestor)) {
        emitted.add(ancestor);
        result.push({
          filename: ancestor,
          name: path.basename(ancestor),
          numFiles: 0,
          realFolderNdx: entry.realFolderNdx,
          scanning: false,
          checking: false,
        });
      }
    }
    if (!emitted.has(entry.filename)) {
      emitted.add(entry.filename);
      result.push(entry);
    }
  });
  return result;
}

type FolderProps = {
  entry: FolderEntry;
  displayName: string;
  count: number;
  folderCount: number;
};

type FolderComponentState = { flashing: boolean };

class Folder extends React.Component<FolderProps, FolderComponentState> {
  static contextType = AppContext;
  declare context: React.ContextType<typeof AppContext>;

  state: FolderComponentState = { flashing: false };

  private _ref = React.createRef<HTMLDivElement>();

  private _handleClick = (): void => {
    this.context.eventBus.dispatch(new ForwardableEvent('goToImage'), this.props.count, this.props.folderCount);
  };

  private _handleContextMenu = (event: React.MouseEvent): void => {
    // Virtual ancestor entries (synthesized empty parents) don't have a
    // FolderStateFolder, but the context-menu actions only need a filename
    // (and an `archive` flag, which is false for these). Synthesize a
    // minimal FolderContextInfo so Refresh / Show in Finder / etc. work.
    const ctxInfo = this.props.entry.realFolder ?? { filename: this.props.entry.filename };
    this.context.eventBus.dispatch(new ForwardableEvent('folderContextMenu', event.nativeEvent), ctxInfo);
  };

  // ── Internal drag-and-drop target ───────────────────────────────────
  // Only offer to accept a drop when there's an in-app drag in flight (we drive
  // everything off drag-context, since the OS drop carries no usable paths).
  private _handleDragOver = (event: React.DragEvent): void => {
    if (getDragContext()) {
      event.preventDefault(); // allow the drop
    }
  };

  private _handleDrop = (event: React.DragEvent): void => {
    if (!getDragContext()) return;
    event.preventDefault();
    this.context.eventBus.dispatch(
      new ForwardableEvent('dropOnFolder'),
      this.props.entry.filename,
      event.metaKey || event.ctrlKey,
    );
  };

  scrollIntoView(): void {
    this._ref.current?.scrollIntoView({
      behavior: 'auto',
      block: 'center',
      inline: 'center',
    });
  }

  // Briefly flash the row's background. Toggles the class off then on (across two
  // frames) so repeated calls restart the CSS animation from the beginning.
  flash(): void {
    this.setState({ flashing: false });
    requestAnimationFrame(() => requestAnimationFrame(() => this.setState({ flashing: true })));
  }

  render(): React.ReactNode {
    const { entry } = this.props;
    const name = this.props.displayName;
    const classes = cssArray(
      'folder',
      entry.scanning ? 'scanning' : undefined,
      entry.checking ? 'checking' : undefined,
      // `virtual` here means a synthesized empty-ancestor row (a different concept);
      // `virtual-folder` is a user-curated virtual folder.
      !entry.realFolder ? 'virtual' : undefined,
      isVirtualFolderKey(entry.filename) ? 'virtual-folder' : undefined,
      this.state.flashing ? 'flash-sync' : undefined,
    );
    return (
      <div
        className={classes.toString()}
        onClick={this._handleClick}
        onContextMenu={this._handleContextMenu}
        onDragOver={this._handleDragOver}
        onDrop={this._handleDrop}
        onAnimationEnd={() => { if (this.state.flashing) this.setState({ flashing: false }); }}
      >
        <div ref={this._ref}>{name} ({entry.numFiles})</div>
      </div>
    );
  }
}

type Props = {
  root: FolderStateRoot;
  show: boolean;
  rotateMode: number;
};

export default class Folders extends React.Component<Props> {
  static contextType = AppContext;
  declare context: React.ContextType<typeof AppContext>;

  private _filenameToRef = new Map<string, React.RefObject<Folder | null>>();
  private main!: HTMLDivElement;

  constructor(props: Props, context: React.ContextType<typeof AppContext>) {
    super(props, context);
    this.context.eventBus.on('scrollFolderViewToFile', this._handleScrollFolderToViewFile);
  }

  componentDidMount(): void {
    this.main.addEventListener('wheel', this._handleWheel as EventListener, { passive: false });
  }

  componentWillUnmount(): void {
    this.main.removeEventListener('wheel', this._handleWheel as EventListener);
    this.context.eventBus.removeListener('scrollFolderViewToFile', this._handleScrollFolderToViewFile);
  }

  private _handleScrollFolderToViewFile = (_event: unknown, folderName: string): void => {
    const ref = this._filenameToRef.get(folderName);
    if (ref) {
      ref.current?.scrollIntoView();
      ref.current?.flash();
    }
  };

  private _handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const pos = getRotatedXY(e, 'delta', this.props.rotateMode);
    this.main.scrollTop += pos.y;
  };

  private renderFolder(root: FolderStateRoot): React.ReactNode[] {
    this._filenameToRef.clear();
    const { prefs } = this.context;
    const entries = buildFolderEntries(
      prefs.folders,
      root.folders,
      !!prefs.misc.showEmptyIfChildNotEmpty,
    );
    const rawNames = prefs.misc.indentByFolderDepth
      ? computeIndentedNames(prefs.folders, entries.map(e => e.filename))
      : entries.map(e => path.basename(e.filename));
    // Virtual folders use their own display name (their key isn't a real path).
    const displayNames = entries.map((e, i) => isVirtualFolderKey(e.filename) ? e.name : rawNames[i]);
    return entries.map((entry, ndx) => {
      const id = `folder-${entry.filename}`;
      const ref = React.createRef<Folder>();
      this._filenameToRef.set(entry.filename, ref);
      return (
        <Folder
          key={id}
          ref={ref}
          entry={entry}
          displayName={displayNames[ndx]}
          // Click navigation targets the entry's first non-empty descendant
          // for virtual rows, or the entry itself otherwise.
          count={entry.realFolderNdx}
          folderCount={entry.realFolderNdx}
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
