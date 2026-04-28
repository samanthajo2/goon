import { describe, it } from '../lib/test/mocha.js';
import { assert } from 'chai';
import { compareVersions, pickAsset } from './auto-update.js';

describe('compareVersions', () => {
  it('orders by major/minor/patch', () => {
    assert.isBelow(compareVersions('1.0.0', '1.0.1'), 0);
    assert.isBelow(compareVersions('1.0.0', '1.1.0'), 0);
    assert.isBelow(compareVersions('1.0.0', '2.0.0'), 0);
    assert.isAbove(compareVersions('1.2.0', '1.1.9'), 0);
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  });

  it('treats missing components as 0', () => {
    assert.equal(compareVersions('1.2', '1.2.0'), 0);
    assert.isBelow(compareVersions('1.2', '1.2.1'), 0);
  });

  it('sorts pre-releases before their base version', () => {
    assert.isBelow(compareVersions('1.0.0-pre.1', '1.0.0'), 0);
    assert.isBelow(compareVersions('1.0.0-alpha', '1.0.0-beta'), 0);
  });
});

describe('pickAsset', () => {
  type FakeRelease = { tag_name: string; name: string; prerelease: boolean; draft: boolean; assets: { name: string; size: number; browser_download_url: string }[] };

  const release: FakeRelease = {
    tag_name: 'v0.0.34',
    name: '0.0.34',
    prerelease: false,
    draft: false,
    assets: [
      { name: 'Goon-0.0.34.dmg', size: 1, browser_download_url: 'https://x/dmg' },
      { name: 'Goon-0.0.34-arm64-mac.zip', size: 1, browser_download_url: 'https://x/zip-arm64' },
      { name: 'Goon-0.0.34-mac.zip', size: 1, browser_download_url: 'https://x/zip-mac' },
      { name: 'Goon Setup 0.0.34.exe', size: 1, browser_download_url: 'https://x/exe' },
      { name: 'Goon-0.0.34.AppImage', size: 1, browser_download_url: 'https://x/appimage' },
    ],
  };

  it('picks the arch-specific zip on darwin/arm64', () => {
    const orig = { platform: process.platform, arch: process.arch };
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    try {
      assert.equal(pickAsset(release as never)?.name, 'Goon-0.0.34-arm64-mac.zip');
    } finally {
      Object.defineProperty(process, 'platform', { value: orig.platform, configurable: true });
      Object.defineProperty(process, 'arch', { value: orig.arch, configurable: true });
    }
  });

  it('picks the NSIS exe on win32', () => {
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      assert.equal(pickAsset(release as never)?.name, 'Goon Setup 0.0.34.exe');
    } finally {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    }
  });

  it('picks the AppImage on linux', () => {
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      assert.equal(pickAsset(release as never)?.name, 'Goon-0.0.34.AppImage');
    } finally {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    }
  });
});
