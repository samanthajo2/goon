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

function readBlob(blob, callback) {
  const reader = new FileReader();
  reader.onload = () => {
    callback(null, reader.result);
  };
  reader.onerror = (e) => {
    callback(e);
  };
  reader.readAsArrayBuffer(blob);
}

function readBlobUrl(filename, callback) {
  const request = new XMLHttpRequest();
  request.open('GET', filename, true);
  request.responseType = 'blob';
  request.onload = () => {
    readBlob(request.response, callback);
  };
  request.onerror = (e) => {
    callback(e);
  };
  request.send();
}

// reads a file from a file or a blob
// returns a Uint8Array

function read(filename, callback) {
  if (filename.startsWith('blob:')) {
    readBlobUrl(filename, callback);
  } else {
    if (filename.startsWith('file:///') || filename.startsWith('file:\\\\\\')) {
      filename = filename.substring(8);
    }
    fs.readFile(decodeURIComponent(filename), (error, data) => {
      callback(error, data ? data.buffer : null);
    });
  }
}

export {
  read,  // eslint-disable-line
};
