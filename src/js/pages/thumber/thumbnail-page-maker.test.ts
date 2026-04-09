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

import sinon from 'sinon';
import { assert } from 'chai';
import createThumbnailPageMaker from './thumbnail-page-maker.js';
import bind from '../../lib/bind.js';
import { getDifferentFilenames, getObjectsByKeys } from '../../lib/utils.js';

// I'm not actually sure what to test here.
//
// I feel like maybe I should break up ThumbnailPageMaker
// Extract out the part that decides when to make a new page
// and where on that page to put a thumbnail. Then can test tat
// Extract out the part that copies images from old pages?
// but that part is pretty straight forward and uses the page making
// part.
//
// Finally there this part but it seems all I can test is that it made
// page and/or deleted old pages. Actually checking where it put
// thumbnails seems like a bad test. Maybe I could make different
// colored images and then read through the image to see they actually
// got placed? But that would require a real canvas API.
// Could try to remember where each one goes in the fake canvas API
// and if not checking positions at least check that the images I expect
// to get drawn get draw?
//
// In other words given remove, changed, added, same as inputs
// same, changed, and added should all get drawn. Same's source should
// be the page wherea added and changed source should be original.
// Could check that
import { describe, it } from '../../lib/test/mocha.js';

type ThumbnailInfo = {
  x: number;
  y: number;
  width: number;
  height: number;
  url?: string;
};

type FileInfo = {
  type?: string;
  orientation?: number;
  width?: number;
  height?: number;
  thumbnail?: ThumbnailInfo;
  fail?: boolean;
  bad?: boolean;
};

type Files = Record<string, FileInfo>;

describe('ThumbnailPageMaker', () => {
  const baseFilename = 'foo/bar/moo';

  function createNewFiles(files: Files, filenames?: string[]): Files {
    filenames = filenames || Object.keys(files);
    const newFiles: Files = {};
    filenames.forEach((filename) => {
      const info = files[filename];
      newFiles[filename] = {
        type: info.type,
      };
    });
    return newFiles;
  }

  function makeMockFileSystem() {
    return {
      writeFileBase64Sync: sinon.stub(),
      unlinkSync: sinon.stub(),
    };
  }

  // This is for when we reload old pages of thumbnails
  function makeMockImageLoader(files: Files, filenames?: string[]) {
    filenames = filenames || Object.keys(files);
    const pages: Record<string, boolean> = {};
    filenames.forEach((filename) => {
      const info = files[filename];
      const thumbnail = info.thumbnail;
      if (thumbnail && thumbnail.url) {
        pages[thumbnail.url] = true;
      }
    });
    const imgLoaderStub = sinon.stub();
    Object.keys(pages).forEach((filename, ndx) => {
      imgLoaderStub.onCall(ndx).resolves({width: 123, height: 456});
    });

    return {
      loadImage: imgLoaderStub,
    };
  }

  function makeContext2D() {
    return {
      canvas: {
        width: 300,
        height: 150,
        toDataURL: sinon.stub().returns('data:image/png;base64,aGVsbG8='),
      },
      drawImage: sinon.stub(),
    };
  }

  function makeMockThubmnailMaker(files: Files, filenames?: string[]) {
    filenames = filenames || Object.keys(files);

    const release = sinon.spy();
    const maker = sinon.stub().callsFake((filename: string /* , fileInfo */) => {
      const ndx = (filenames as string[]).indexOf(filename);
      if (ndx < 0) {
        throw new Error(`request for disallowed file: ${filename}`);
      }
      (filenames as string[]).splice(ndx, 1);
      const info = files[filename];
      if (info.fail) {
        return Promise.reject(new Error('dummyElement'));
      }
      return Promise.resolve({
        release: release,
        info,
        canvas: {
          foo: 'fake canvas',
          width: info.thumbnail!.width,
          height: info.thumbnail!.height,
        },
      });
    });

    return { release, maker };
  }

  class Context2DManager {
    contexts: ReturnType<typeof makeContext2D>[];
    constructor() {
      this.contexts = [];
      bind(
        this,
        'createContext',
      );
    }
    createContext() {
      const ctx = makeContext2D();
      this.contexts.push(ctx);
      return ctx;
    }
  }

  type TPMOptions = {
    thumbnailWidth: number;
    pageSize: number;
    files: Files;
    newFilenames?: string[];
    oldFilenames?: string[];
    imageLoader?: { loadImage: sinon.SinonStub };
    thumbnailFilenames?: string[];
  };

  function prepFiles(files: Files, thumbnailWidth: number): Files {
    const newFiles: Files = JSON.parse(JSON.stringify(files));
    Object.keys(newFiles).forEach((filename) => {
      const info = newFiles[filename];
      info.type = info.type || 'image/jpeg';
      info.width = info.width || 512;
      info.height = info.height || 512;
      info.orientation = info.orientation || 0;
      const thumbnail: Partial<ThumbnailInfo> = info.thumbnail || {};
      info.thumbnail = thumbnail as ThumbnailInfo;
      thumbnail.x = thumbnail.x || 0;
      thumbnail.y = thumbnail.y || 0;
      thumbnail.width = thumbnail.width || thumbnailWidth;
      thumbnail.height = thumbnail.height || (info.height! * thumbnailWidth / info.width! | 0);
    });
    return newFiles;
  }

  async function testThumbnailPageMaker(options: TPMOptions) {
    const thumbnailWidth = options.thumbnailWidth;
    const pageSize = options.pageSize;
    const files = prepFiles(options.files, thumbnailWidth);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oldFiles = getObjectsByKeys(files as any, options.oldFilenames || []) as Files;
    const newFiles = createNewFiles(files, options.newFilenames);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const diffNames = getDifferentFilenames(oldFiles as any, newFiles as any);

    const mockImageLoader = makeMockImageLoader(files, diffNames.same);
    const mockThumbnailMaker = makeMockThubmnailMaker(files, options.thumbnailFilenames || [...diffNames.added, ...diffNames.changed]);
    const mockFS = makeMockFileSystem();
    const ctxManager = new Context2DManager();
    const thumbnailObserver = sinon.spy();

    const tPMaker = createThumbnailPageMaker({
      thumbnailMaker: mockThumbnailMaker.maker as Parameters<typeof createThumbnailPageMaker>[0]['thumbnailMaker'],
      thumbnailWidth: thumbnailWidth,
      pageSize: pageSize,
      context2DFactory: ctxManager.createContext as unknown as () => CanvasRenderingContext2D,
      fs: mockFS,
      imgLoader: options.imageLoader || mockImageLoader,
      thumbnailObserver: thumbnailObserver,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tFiles = await tPMaker(baseFilename, oldFiles as any, newFiles as any);
    return {
      tFiles,
      mockThumbnailMaker,
      mockImageLoader,
      mockFS,
      ctxManager,
      thumbnailObserver,
    };
  }

  function dumpInfo(r: Awaited<ReturnType<typeof testThumbnailPageMaker>>) {  // eslint-disable-line
    console.log('imgLoaderStub callCount', r.mockImageLoader.loadImage.callCount);
    console.log('unlinkStub callCount', r.mockFS.unlinkSync.callCount);
    console.log('writeFileBase64Sync callCount', r.mockFS.writeFileBase64Sync.callCount);
    console.log('numContexts:', r.ctxManager.contexts.length);
    const thumbCtx = r.ctxManager.contexts[0];
    console.log('thumbCtx.drawImage callCount', thumbCtx.drawImage.callCount);
    const page0Ctx = r.ctxManager.contexts[1];
    console.log('page0Ctx.drawImage callcount', page0Ctx.drawImage.callCount);
    page0Ctx.drawImage.getCalls().forEach((call, ndx) => {
      console.log(ndx, ...call.args);
    });
  }

  it('makes a page', async () => {
    const r = await testThumbnailPageMaker({
      thumbnailWidth: 150,
      pageSize: 450,
      files: {
        'abc.jpg': {},
        'def.jpg': {},
        'ghi.jpg': {},
      },
    });
    assert.strictEqual(r.mockThumbnailMaker.release.callCount, 3, '3 thumbnails made');
    assert.strictEqual(r.thumbnailObserver.callCount, 3, '3 thumbnails observed');
    assert.strictEqual(r.mockFS.writeFileBase64Sync.callCount, 1, 'writes one page');
  });

  it('makes 3 pages', async () => {
    const r = await testThumbnailPageMaker({
      thumbnailWidth: 150,
      pageSize: 200,
      files: {
        'abc.jpg': {},
        'def.jpg': {},
        'ghi.jpg': {},
      },
    });
    assert.strictEqual(r.mockThumbnailMaker.release.callCount, 3, '3 thumbnails made');
    assert.strictEqual(r.thumbnailObserver.callCount, 3, '3 thumbnails observed');
    assert.strictEqual(r.mockFS.writeFileBase64Sync.callCount, 3, 'writes 3 pages');
  });

  it('remakes a page', async () => {
    const files: Files = {
      'abc.jpg': { thumbnail: { url: 'page1', x:   0, y: 0, width: 150, height: 150 } },  
      'def.jpg': { thumbnail: { url: 'page1', x: 150, y: 0, width: 150, height: 150 } },  
      'ghi.jpg': { thumbnail: { url: 'page1', x: 300, y: 0, width: 150, height: 150 } },  
    };
    const r = await testThumbnailPageMaker({
      thumbnailWidth: 150,
      pageSize: 450,
      files: files,
      oldFilenames: Object.keys(files),
    });
    assert.strictEqual(r.mockThumbnailMaker.release.callCount, 0, '0 thumbnails made');
    assert.strictEqual(r.thumbnailObserver.callCount, 0, '0 thumbnails observed');
    assert.strictEqual(r.mockFS.unlinkSync.callCount, 1, 'deletes one page');
    assert.strictEqual(r.mockFS.writeFileBase64Sync.callCount, 1, 'writes one page');
  });

  it('remakes 3 pages', async () => {
    const files: Files = {
      'abc.jpg': { thumbnail: { url: 'page1', x:   0, y: 0, width: 150, height: 150 } },  
      'def.jpg': { thumbnail: { url: 'page2', x: 150, y: 0, width: 150, height: 150 } },  
      'ghi.jpg': { thumbnail: { url: 'page3', x: 300, y: 0, width: 150, height: 150 } },  
    };
    const r = await testThumbnailPageMaker({
      thumbnailWidth: 150,
      pageSize: 200,
      files: files,
      oldFilenames: Object.keys(files),
    });
    assert.strictEqual(r.mockThumbnailMaker.release.callCount, 0, '0 thumbnails made');
    assert.strictEqual(r.thumbnailObserver.callCount, 0, '0 thumbnails observed');
    assert.strictEqual(r.mockFS.unlinkSync.callCount, 3, 'deletes 3 pages');
    assert.strictEqual(r.mockFS.writeFileBase64Sync.callCount, 3, 'writes 3 pages');
  });

  it('delete 3 pages makes 1', async () => {
    const files: Files = {
      'abc.jpg': { thumbnail: { url: 'page1', x:   0, y: 0, width: 150, height: 150 } },  
      'def.jpg': { thumbnail: { url: 'page2', x: 150, y: 0, width: 150, height: 150 } },  
      'ghi.jpg': { thumbnail: { url: 'page3', x: 300, y: 0, width: 150, height: 150 } },  
    };
    const r = await testThumbnailPageMaker({
      thumbnailWidth: 150,
      pageSize: 450,
      files: files,
      oldFilenames: Object.keys(files),
    });
    assert.strictEqual(r.mockThumbnailMaker.release.callCount, 0, '0 thumbnails made');
    assert.strictEqual(r.thumbnailObserver.callCount, 0, '0 thumbnails observed');
    assert.strictEqual(r.mockFS.unlinkSync.callCount, 3, 'deletes 3 pages');
    assert.strictEqual(r.mockFS.writeFileBase64Sync.callCount, 1, 'writes 1 pages');
    for (const fileInfo of Object.values(r.tFiles)) {
      assert.isTrue((fileInfo as FileInfo).thumbnail!.url!.indexOf('_0.png?') > 0);
    }
  });

  it('remakes a page with 2 old and 1 new file', async () => {
    const files: Files = {
      'abc.jpg': { thumbnail: { url: 'page1', x:   0, y: 0, width: 150, height: 150 } },  
      'def.jpg': { thumbnail: { url: 'page1', x: 150, y: 0, width: 150, height: 150 } },  
      'ghi.jpg': { thumbnail: { url: 'page1', x: 300, y: 0, width: 150, height: 150 } },  
    };
    const r = await testThumbnailPageMaker({
      thumbnailWidth: 150,
      pageSize: 450,
      files: files,
      oldFilenames: Object.keys(files).slice(0, 2),
    });
    assert.strictEqual(r.mockThumbnailMaker.release.callCount, 1, '1 thumbnails made');
    assert.strictEqual(r.thumbnailObserver.callCount, 1, '1 thumbnails observed');
    assert.strictEqual(r.mockFS.unlinkSync.callCount, 1, 'deletes one page');
    assert.strictEqual(r.mockFS.writeFileBase64Sync.callCount, 1, 'writes one page');
  });

  it('works if can not make a thumbnail', async () => {
    const files: Files = {
      'abc.jpg': {},
      'def.jpg': { fail: true },
      'ghi.jpg': {},
    };
    const r = await testThumbnailPageMaker({
      thumbnailWidth: 150,
      pageSize: 450,
      files: files,
    });
    assert.strictEqual(r.mockThumbnailMaker.release.callCount, 2, '2 thumbnails made');
    assert.strictEqual(r.thumbnailObserver.callCount, 2, '2 thumbnails observed');
    assert.strictEqual(r.mockFS.writeFileBase64Sync.callCount, 1, 'writes one page');
    for (const [filename, fileInfo] of Object.entries(r.tFiles)) {
      const expected = files[filename];
      if (expected.fail) {
        assert.isOk((fileInfo as FileInfo).bad);
      } else {
        assert.isNotOk((fileInfo as FileInfo).bad);
      }
    }
  });

  it('remakes thumbnails if can not load page', async () => {
    const files: Files = {
      'abc.jpg': { thumbnail: { url: 'page1', x:   0, y: 0, width: 150, height: 150 } },  
      'def.jpg': { thumbnail: { url: 'page1', x: 150, y: 0, width: 150, height: 150 } },  
      'ghi.jpg': { thumbnail: { url: 'page1', x: 300, y: 0, width: 150, height: 150 } },  
    };
    const r = await testThumbnailPageMaker({
      thumbnailWidth: 150,
      pageSize: 450,
      files: files,
      oldFilenames: Object.keys(files),
      // need to pass because by looking at old and new no files would
      // be loaded. But, because we are testing the old page png can't
      // be loaded these file should get loaded.
      thumbnailFilenames: Object.keys(files),
      imageLoader: {
        loadImage: sinon.stub().rejects(new Error('fake image load fail')),
      },
    });
    assert.strictEqual(r.mockThumbnailMaker.release.callCount, 3, '3 thumbnails made');
    assert.strictEqual(r.thumbnailObserver.callCount, 3, '3 thumbnails observed');
    assert.strictEqual(r.mockFS.unlinkSync.callCount, 0, 'deletes no page');
    assert.strictEqual(r.mockFS.writeFileBase64Sync.callCount, 1, 'writes one page');
  });
});
