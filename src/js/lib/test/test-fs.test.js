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

import fs from 'fs';
import path from 'path';
import {assert} from 'chai';
import TestFS from './test-fs';
import {makePublicPromise} from './test-utils';

describe('TestFS', () => {
  it('cleans up', () => {
    const testFS = new TestFS();

    const baseFilename = testFS.baseFilename;
    const filename1 = path.join(baseFilename, 'test1');
    const foldername1 = path.join(baseFilename, 'test2');
    const filename2 = path.join(foldername1, 'test3');

    testFS.writeFileSync(filename1, 'foo');
    testFS.mkdirSync(foldername1);
    testFS.writeFileSync(filename2, 'foo');

    testFS.close();

    assert.isNotOk(fs.existsSync(filename1));
    assert.isNotOk(fs.existsSync(foldername1));
    assert.isNotOk(fs.existsSync(filename2));
  });

  it('cleans up async', async () => {
    const testFS = new TestFS();

    const baseFilename = testFS.baseFilename;
    const filename1 = path.join(baseFilename, 'test1');
    const foldername1 = path.join(baseFilename, 'test2');
    const filename2 = path.join(foldername1, 'test3');

    const file1 = makePublicPromise();
    testFS.writeFile(filename1, 'foo', file1.resolve);
    const folder1 = makePublicPromise();
    testFS.mkdir(foldername1, file1, folder1.resolve);

    await folder1.promise;

    const file2 = makePublicPromise();
    testFS.writeFile(filename2, 'foo', file2.resolve);

    await file1.promise;
    await file2.promise;

    testFS.close();

    assert.isNotOk(fs.existsSync(filename1));
    assert.isNotOk(fs.existsSync(foldername1));
    assert.isNotOk(fs.existsSync(filename2));
  });
});
