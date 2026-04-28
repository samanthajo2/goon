/*
  Custom auto-updater for unsigned Goon builds.

  Why not electron-updater / Squirrel? Squirrel.Mac requires the new bundle to
  carry a Developer ID signature matching the running app's. Without an Apple
  Developer cert there's no way to satisfy that, so we roll our own.

  Behavior per platform once an update is available:
    - macOS: download the .zip, ditto-extract it to a temp dir, then on
      "quit and install" spawn a detached bash helper that waits for our
      PID to exit, swaps the .app bundle, and relaunches via `open`.
    - Windows: download the NSIS installer and spawn it with /S --force-run;
      the installer handles replacement and relaunch itself.
    - Linux (AppImage): download the new AppImage and spawn a detached helper
      that waits for our PID to exit, moves the file over process.execPath,
      chmods +x, and relaunches.

  Check vs download are separate — the user must explicitly opt into the
  download. We poll GitHub's releases API directly. No latest-mac.yml needed.
*/

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { app } from '../lib/electron-imports.js';

const REPO_OWNER = 'samanthajo2';
const REPO_NAME = 'goon';
const USER_AGENT = `${REPO_NAME}-auto-updater`;

type GitHubAsset = {
  name: string;
  size: number;
  browser_download_url: string;
};

type GitHubRelease = {
  tag_name: string;
  name: string;
  prerelease: boolean;
  draft: boolean;
  assets: GitHubAsset[];
};

export type DownloadProgressInfo = {
  transferred: number;
  total: number;
  percent: number;
};

export type UpdateInfo = {
  version: string;
};

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'no-update'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

// Compare two semver-ish strings. Returns negative if a<b, 0 if equal, positive if a>b.
// Handles plain "1.2.3" and "1.2.3-pre.4" forms; pre-release sorts before release.
function compareVersions(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const [base, pre = ''] = v.split('-', 2);
    return { nums: base.split('.').map(n => parseInt(n, 10) || 0), pre };
  };
  const A = parse(a);
  const B = parse(b);
  const len = Math.max(A.nums.length, B.nums.length);
  for (let i = 0; i < len; i++) {
    const d = (A.nums[i] ?? 0) - (B.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  // Pre-release sorts before its base release.
  if (A.pre && !B.pre) return -1;
  if (!A.pre && B.pre) return 1;
  if (A.pre < B.pre) return -1;
  if (A.pre > B.pre) return 1;
  return 0;
}

function httpsGet(url: string, headers: Record<string, string> = {}): Promise<{ statusCode: number; body: string; redirect?: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, ...headers },
    }, (res) => {
      const status = res.statusCode ?? 0;
      // Follow redirects (GitHub asset URLs redirect to S3).
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        resolve({ statusCode: status, body: '', redirect: res.headers.location });
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        resolve({ statusCode: status, body: Buffer.concat(chunks).toString('utf8') });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const r = await httpsGet(current, { 'Accept': 'application/vnd.github+json' });
    if (r.redirect) { current = r.redirect; continue; }
    if (r.statusCode !== 200) {
      throw new Error(`GET ${url} → HTTP ${r.statusCode}: ${r.body.slice(0, 200)}`);
    }
    return JSON.parse(r.body) as T;
  }
  throw new Error(`Too many redirects fetching ${url}`);
}

function downloadToFile(url: string, dest: string, onProgress: (p: DownloadProgressInfo) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const followGet = (currentUrl: string, redirects: number) => {
      if (redirects > 5) {
        reject(new Error(`Too many redirects downloading ${url}`));
        return;
      }
      https.get(currentUrl, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          followGet(res.headers.location, redirects + 1);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`Download ${currentUrl} → HTTP ${status}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] ?? '0', 10);
        let transferred = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', (chunk: Buffer) => {
          transferred += chunk.length;
          onProgress({ transferred, total, percent: total ? (100 * transferred / total) : 0 });
        });
        res.pipe(out);
        out.on('finish', () => { out.close(() => resolve()); });
        out.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    };
    followGet(url, 0);
  });
}

function pickAsset(release: GitHubRelease): GitHubAsset | null {
  const platform = process.platform;
  const arch = process.arch;
  const matchers: ((name: string) => boolean)[] = [];
  if (platform === 'darwin') {
    // Prefer arch-specific zip; fall back to generic mac zip.
    matchers.push(name => name.endsWith(`-${arch}-mac.zip`));
    matchers.push(name => name.endsWith('-mac.zip'));
  } else if (platform === 'win32') {
    // electron-builder NSIS installer: "Goon Setup x.y.z.exe".
    matchers.push(name => /Setup.*\.exe$/i.test(name));
    matchers.push(name => name.endsWith('.exe'));
  } else if (platform === 'linux') {
    matchers.push(name => name.endsWith('.AppImage'));
  }
  for (const match of matchers) {
    const found = release.assets.find(a => match(a.name));
    if (found) return found;
  }
  return null;
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'goon-update-'));
}

class AutoUpdater extends EventEmitter {
  private _state: UpdateState = 'idle';
  private _availableRelease: { asset: GitHubAsset; version: string } | null = null;
  private _downloadedFile: string | null = null;
  private _extractedAppPath: string | null = null;

  get state(): UpdateState { return this._state; }
  get availableVersion(): string | null { return this._availableRelease?.version ?? null; }

  /**
   * Check GitHub for a newer release. If we've already checked this session
   * and have a cached result, re-emit the cached events (so a freshly opened
   * update window can sync up without a redundant network call). Pass force=true
   * to bypass the cache and re-check.
   */
  async checkForUpdates(force = false): Promise<void> {
    if (!force) {
      switch (this._state) {
        case 'available':
          this.emit('update-available', { version: this._availableRelease!.version });
          return;
        case 'no-update':
          this.emit('update-not-available', { version: this._availableRelease?.version });
          return;
        case 'downloading':
        case 'downloaded':
          // A download is in progress or complete — nothing to re-check. The
          // window will pick up state via getState() if it's interested.
          if (this._state === 'downloaded') {
            this.emit('update-downloaded', { version: this._availableRelease!.version });
          }
          return;
        case 'checking':
          // Already in flight; events will fire when done.
          return;
        case 'error':
        case 'idle':
        default:
          break;
      }
    }
    this._state = 'checking';
    this.emit('checking-for-update');
    try {
      const release = await fetchJson<GitHubRelease>(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      );
      const currentVer = app.getVersion();
      const latestVer = release.tag_name.replace(/^v/, '');
      if (release.draft || compareVersions(latestVer, currentVer) <= 0) {
        this._state = 'no-update';
        this.emit('update-not-available', { version: latestVer });
        return;
      }
      const asset = pickAsset(release);
      if (!asset) {
        throw new Error(`No update asset for ${process.platform}/${process.arch} in release ${release.tag_name}`);
      }
      this._availableRelease = { asset, version: latestVer };
      this._state = 'available';
      this.emit('update-available', { version: latestVer });
    } catch (err) {
      this._state = 'error';
      this.emit('error', err);
    }
  }

  /**
   * Download the asset previously identified by checkForUpdates(). Must be
   * called after an 'update-available' event.
   */
  async downloadUpdate(): Promise<void> {
    if (this._state !== 'available' || !this._availableRelease) {
      this.emit('error', new Error(`Cannot download: no available update (state=${this._state})`));
      return;
    }
    this._state = 'downloading';
    const { asset, version } = this._availableRelease;
    try {
      const dir = tempDir();
      const dest = path.join(dir, asset.name);
      await downloadToFile(asset.browser_download_url, dest, (p) => {
        this.emit('download-progress', p);
      });
      this._downloadedFile = dest;
      // macOS: extract the zip now so quit-and-install is just a swap.
      if (process.platform === 'darwin') {
        const extractDir = path.join(dir, 'extracted');
        fs.mkdirSync(extractDir);
        await runCommand('ditto', ['-xk', dest, extractDir]);
        const apps = fs.readdirSync(extractDir).filter(n => n.endsWith('.app'));
        if (apps.length === 0) {
          throw new Error(`No .app found in extracted ${asset.name}`);
        }
        this._extractedAppPath = path.join(extractDir, apps[0]);
      }
      this._state = 'downloaded';
      this.emit('update-downloaded', { version });
    } catch (err) {
      this._state = 'error';
      this.emit('error', err);
    }
  }

  quitAndInstall(): void {
    try {
      if (process.platform === 'darwin') this._installMac();
      else if (process.platform === 'win32') this._installWindows();
      else if (process.platform === 'linux') this._installLinux();
      else throw new Error(`Unsupported platform: ${process.platform}`);
    } catch (err) {
      this.emit('error', err);
    }
  }

  private _installMac(): void {
    if (!this._extractedAppPath) throw new Error('Update not downloaded');
    // Resolve the running .app bundle path. app.getPath('exe') points at the
    // binary inside Contents/MacOS, so walk up until we find the .app dir.
    let current = path.dirname(app.getPath('exe'));
    while (current !== '/' && !current.endsWith('.app')) {
      current = path.dirname(current);
    }
    if (!current.endsWith('.app')) throw new Error('Could not locate running .app bundle');
    const targetApp = current;
    const newApp = this._extractedAppPath;
    const pid = process.pid;
    // Detached bash helper: wait for our PID to exit, swap, relaunch.
    const script = `
      while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done
      rm -rf ${shellQuote(targetApp)}
      mv ${shellQuote(newApp)} ${shellQuote(targetApp)}
      open ${shellQuote(targetApp)}
    `;
    spawn('/bin/bash', ['-c', script], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  }

  private _installWindows(): void {
    if (!this._downloadedFile) throw new Error('Update not downloaded');
    // electron-builder NSIS installer:
    //   /S            silent install
    //   --force-run   relaunch the app after install completes
    spawn(this._downloadedFile, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  }

  private _installLinux(): void {
    if (!this._downloadedFile) throw new Error('Update not downloaded');
    const target = process.env.APPIMAGE ?? process.execPath;
    const newFile = this._downloadedFile;
    const pid = process.pid;
    const script = `
      while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done
      mv ${shellQuote(newFile)} ${shellQuote(target)}
      chmod +x ${shellQuote(target)}
      ${shellQuote(target)} &
    `;
    spawn('/bin/bash', ['-c', script], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

export const autoUpdater = new AutoUpdater();

// Exported for unit testing.
export { compareVersions, pickAsset };
