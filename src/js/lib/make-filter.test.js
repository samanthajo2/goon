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

import path from 'path';
import {assert} from 'chai';
import moment from 'moment';
import {makeFilter} from './make-filter';

function prepFiles(files) {
  Object.keys(files).forEach((filename, ndx) => {
    const fileInfo = files[filename];
    Object.assign(fileInfo, {
      width: (ndx + 1) * 100,
      height: (ndx + 1) * 100 + 50,
      mtime: moment(`200${ndx}-02-01`).valueOf(),
      filename: filename,
      folderName: path.dirname(filename).toLowerCase(),
      baseName: path.basename(filename).toLowerCase(),
      displayName: filename,
      lowercaseName: filename.toLowerCase(),
    });
  });
  return files;
}

describe('makeFilter', () => {
  const defaultFiles = prepFiles({
    'foo/abc': { type: 'image/jpeg', size: 1, },
    'foo/def': { type: 'image/gif',  size: 1024, },  // 1k
    'bar/ghi': { type: 'image/png',  size: 1024 * 1024, },  // 1m
    'bar/jkl': { type: 'video/mp4',  size: 1024 * 1024 * 1024, },  // 1g
    'moo/abc': { type: 'video/mkv',  size: 1024 * 1024 * 1024 * 1024, }, // 1t
    'moo/jkl': { type: 'video/ogv',  size: 1024 * 1024 * 1024 * 1024 * 1024 }, // 1e
  });

  function testFilter(filterResults, files = defaultFiles) {
    assert.isNotOk(filterResults.error);

    const results = {};
    for (const [filename, fileInfo] of Object.entries(files)) {
      if (filterResults.filter(filename, fileInfo)) {
        results[filename] = fileInfo;
      }
    }
    return results;
  }

  it('handles empty string', () => {
    assert.hasAllKeys(testFilter(makeFilter('')), ['foo/abc', 'foo/def', 'bar/ghi', 'bar/jkl', 'moo/abc', 'moo/jkl']);
  });

  it('handles globs', () => {
    assert.hasAllKeys(testFilter(makeFilter('abc')), ['foo/abc', 'moo/abc']);
    assert.hasAllKeys(testFilter(makeFilter('a')), ['foo/abc', 'bar/ghi', 'bar/jkl', 'moo/abc']);
    assert.hasAllKeys(testFilter(makeFilter('j*')), ['bar/jkl', 'moo/jkl'], 'starts with j');
    assert.hasAllKeys(testFilter(makeFilter('*l')), ['bar/jkl', 'moo/jkl'], 'ends with l');
    assert.hasAllKeys(testFilter(makeFilter('?oo')), ['foo/abc', 'foo/def', 'moo/abc', 'moo/jkl'], 'has ?oo');
    assert.hasAllKeys(testFilter(makeFilter('ABC')), ['foo/abc', 'moo/abc']);
  });

  it('handles width and height', () => {
    assert.hasAllKeys(testFilter(makeFilter('width:>500')), ['moo/jkl']);
    assert.hasAllKeys(testFilter(makeFilter('width:>=500')), ['moo/abc', 'moo/jkl']);
    assert.hasAllKeys(testFilter(makeFilter('width:<200')), ['foo/abc']);
    assert.hasAllKeys(testFilter(makeFilter('width:<=200')), ['foo/abc', 'foo/def']);
    assert.hasAllKeys(testFilter(makeFilter('width:=300')), ['bar/ghi']);
    assert.hasAllKeys(testFilter(makeFilter('width:==400')), ['bar/jkl']);
    assert.hasAllKeys(testFilter(makeFilter('width:!=400')), ['foo/abc', 'foo/def', 'bar/ghi', /* 'bar/jkl', */ 'moo/abc', 'moo/jkl']);
    assert.hasAllKeys(testFilter(makeFilter('width:!==400')), ['foo/abc', 'foo/def', 'bar/ghi', /* 'bar/jkl', */ 'moo/abc', 'moo/jkl']);

    assert.hasAllKeys(testFilter(makeFilter('height:>550')), ['moo/jkl']);
    assert.hasAllKeys(testFilter(makeFilter('height:>=550')), ['moo/abc', 'moo/jkl']);
    assert.hasAllKeys(testFilter(makeFilter('height:<250')), ['foo/abc']);
    assert.hasAllKeys(testFilter(makeFilter('height:<=250')), ['foo/abc', 'foo/def']);
    assert.hasAllKeys(testFilter(makeFilter('height:=350')), ['bar/ghi']);
    assert.hasAllKeys(testFilter(makeFilter('height:==450')), ['bar/jkl']);
    assert.hasAllKeys(testFilter(makeFilter('height:!=450')), ['foo/abc', 'foo/def', 'bar/ghi', /* 'bar/jkl', */ 'moo/abc', 'moo/jkl']);
    assert.hasAllKeys(testFilter(makeFilter('height:!==450')), ['foo/abc', 'foo/def', 'bar/ghi', /* 'bar/jkl', */ 'moo/abc', 'moo/jkl']);

    assert.isOk(makeFilter('width:').error);
    assert.isOk(makeFilter('width:foo').error);
    assert.deepEqual(makeFilter('width:<100').filterTypesUsed, {'width': true});
    assert.deepEqual(makeFilter('height:<100').filterTypesUsed, {'height': true});

    const orientedFiles = {
      'abc': { width: 100, height: 200, orientation: 5, },
      'def': { width: 200, height: 100, orientation: 6, },
    };
    assert.hasAllKeys(testFilter(makeFilter('height:>150'), orientedFiles), ['def']);
    assert.hasAllKeys(testFilter(makeFilter('width:>150'), orientedFiles), ['abc']);
  });

  it('handles aspect', () => {
    const files = {
      'abc': { width: 100, height: 200, },
      'def': { width: 200, height: 100, },
    };
    assert.hasAllKeys(testFilter(makeFilter('aspect:>1'), files), ['def']);
    assert.hasAllKeys(testFilter(makeFilter('aspect:<1'), files), ['abc']);
    assert.hasAllKeys(testFilter(makeFilter('aspect:landscape'), files), ['def']);
    assert.hasAllKeys(testFilter(makeFilter('aspect:portrait'), files), ['abc']);
    const orientedFiles = {
      'abc': { width: 100, height: 200, orientation: 5, },
      'def': { width: 200, height: 100, orientation: 6, },
    };
    assert.hasAllKeys(testFilter(makeFilter('aspect:>1'), orientedFiles), ['abc']);
    assert.hasAllKeys(testFilter(makeFilter('aspect:<1'), orientedFiles), ['def']);
    assert.hasAllKeys(testFilter(makeFilter('aspect:landscape'), orientedFiles), ['abc']);
    assert.hasAllKeys(testFilter(makeFilter('aspect:portrait'), orientedFiles), ['def']);

    assert.deepEqual(makeFilter('aspect:<1').filterTypesUsed, {'aspect': true});
  });

  it('handles folder', () => {
    assert.isEmpty(testFilter(makeFilter('folder:abc')));
    assert.hasAllKeys(testFilter(makeFilter('folder:a')), ['bar/ghi', 'bar/jkl']);
    assert.hasAllKeys(testFilter(makeFilter('folder:moo')), ['moo/abc', 'moo/jkl']);
    assert.hasAllKeys(testFilter(makeFilter('folder:MOO')), ['moo/abc', 'moo/jkl']);

    assert.isEmpty(testFilter(makeFilter('dir:abc')));
    assert.hasAllKeys(testFilter(makeFilter('dir:a')), ['bar/ghi', 'bar/jkl']);
    assert.hasAllKeys(testFilter(makeFilter('dir:moo')), ['moo/abc', 'moo/jkl']);

    assert.isEmpty(testFilter(makeFilter('dirname:abc')));
    assert.hasAllKeys(testFilter(makeFilter('dirname:a')), ['bar/ghi', 'bar/jkl']);
    assert.hasAllKeys(testFilter(makeFilter('dirname:moo')), ['moo/abc', 'moo/jkl']);

    assert.deepEqual(makeFilter('folder:foo').filterTypesUsed, {'folder': true});
    assert.deepEqual(makeFilter('dir:foo').filterTypesUsed, {'folder': true});
    assert.deepEqual(makeFilter('dirname:foo').filterTypesUsed, {'folder': true});
  });

  it('handles filename', () => {
    assert.hasAllKeys(testFilter(makeFilter('filename:a')), ['foo/abc', 'moo/abc']);
    assert.hasAllKeys(testFilter(makeFilter('basename:a')), ['foo/abc', 'moo/abc']);
    assert.hasAllKeys(testFilter(makeFilter('filename:A')), ['foo/abc', 'moo/abc']);

    assert.deepEqual(makeFilter('filename:foo').filterTypesUsed, {'filename': true});
    assert.deepEqual(makeFilter('basename:foo').filterTypesUsed, {'filename': true});
  });

  it('handles type', () => {
    assert.hasAllKeys(testFilter(makeFilter('type:image')), ['foo/abc', 'foo/def', 'bar/ghi']);
    assert.hasAllKeys(testFilter(makeFilter('type:gif')), ['foo/def']);

    assert.deepEqual(makeFilter('type:foo').filterTypesUsed, {'type': true});
  });


  it('size k, m, g, kb, mb, gb', () => {
    assert.hasAllKeys(testFilter(makeFilter('size:<100')), ['foo/abc']);
    assert.hasAllKeys(testFilter(makeFilter('size:<2k')), ['foo/abc', 'foo/def']);
    assert.hasAllKeys(testFilter(makeFilter('size:<2m')), ['foo/abc', 'foo/def', 'bar/ghi']);
    assert.hasAllKeys(testFilter(makeFilter('size:<2g')), ['foo/abc', 'foo/def', 'bar/ghi', 'bar/jkl']);
    assert.hasAllKeys(testFilter(makeFilter('size:<2t')), ['foo/abc', 'foo/def', 'bar/ghi', 'bar/jkl', 'moo/abc']);

    assert.hasAllKeys(testFilter(makeFilter('size:<100b')), ['foo/abc']);
    assert.hasAllKeys(testFilter(makeFilter('size:<2kb')), ['foo/abc', 'foo/def']);
    assert.hasAllKeys(testFilter(makeFilter('size:<2mb')), ['foo/abc', 'foo/def', 'bar/ghi']);
    assert.hasAllKeys(testFilter(makeFilter('size:<2gb')), ['foo/abc', 'foo/def', 'bar/ghi', 'bar/jkl']);
    assert.hasAllKeys(testFilter(makeFilter('size:<2tb')), ['foo/abc', 'foo/def', 'bar/ghi', 'bar/jkl', 'moo/abc']);

    assert.hasAllKeys(testFilter(makeFilter('size:<100B')), ['foo/abc']);
    assert.hasAllKeys(testFilter(makeFilter('size:<2KB')), ['foo/abc', 'foo/def']);

    assert.deepEqual(makeFilter('size:<100').filterTypesUsed, {'size': true});

    assert.isOk(makeFilter('size:<100f').error);
  });

  it('date', () => {
    assert.hasAllKeys(testFilter(makeFilter('date:<2002-01-01')), ['foo/abc', 'foo/def']);
    assert.hasAllKeys(testFilter(makeFilter('date:<2003')), ['foo/abc', 'foo/def', 'bar/ghi']);
    assert.hasAllKeys(testFilter(makeFilter('date:>2002-02')), ['moo/abc', 'moo/jkl', 'bar/jkl']);

    assert.deepEqual(makeFilter('date:>2000').filterTypesUsed, {'date': true});
  });

  it('multiple expressions', () => {
    assert.hasAllKeys(testFilter(makeFilter('date:>2002 date:<2004')), ['bar/ghi', 'bar/jkl']);

    assert.deepEqual(
      makeFilter('size:<100 date:>2002 aspect:<3').filterTypesUsed,
      {'size': true, 'date': true, 'aspect': true},
    );
  });

  it('handles spaces', () => {
    const files = prepFiles({
      'foo/abc def': {},
      'foo/cde jkl': {},
    });
    assert.hasAllKeys(testFilter(makeFilter('c d'), files), ['foo/abc def']);
    assert.hasAllKeys(testFilter(makeFilter('"c d"'), files), ['foo/abc def']);
    assert.hasAllKeys(testFilter(makeFilter('filename:"c d"'), files), ['foo/abc def']);
  });

  it('handles bad', () => {
    const files = prepFiles({
      'ggg': { },
      'bbb': { bad: true, },
    });
    assert.hasAllKeys(testFilter(makeFilter('bad:'), files), ['bbb']);
  });
});
