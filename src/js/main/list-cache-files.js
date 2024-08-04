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

export default function listCacheFiles(userDataDir) {
  const files = fs.readdirSync(userDataDir).filter((name) => path.basename(name).startsWith('folder-') && name.endsWith('.json')).map((name) => {
    const filename = path.join(userDataDir, name);
    try {
      const data = JSON.parse(fs.readFileSync(filename, {encoding: 'utf8'}));
      return {
        version: data.version,
        foldername: data.folderPath,
        filename: filename,
      };
    } catch (e) {
      console.error('can not open/parse file:', filename);
      return {
        bad: true,
        filename: filename,
      };
    }
  });

  files.sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));

  const results = files.map((file) => JSON.stringify(file));

  console.log('[\n', results.join(',\n'), '\n]');
}
