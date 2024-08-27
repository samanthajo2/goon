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

/*
import * as filters from '../../lib/filters';
import * as exif from './exif';
import { urlFromFilename } from '../../lib/utils';

const orientationREs = [
  /top.*left/i,     // orientation: 1, },
  /top.*right/i,    // orientation: 2, },
  /bottom.*right/i, // orientation: 3, },
  /bottom.*left/i,  // orientation: 4, },
  /left.*top/i,     // orientation: 5, },
  /right.*top/i,    // orientation: 6, },
  /right.*bottom/i, // orientation: 7, },
  /left.*bottom/i,  // orientation: 8, },
];
*/

export default function loadMeta(/* filename, type */) {
  return Promise.resolve({orientation: 0});
  // return new Promise((resolve /* , reject */) => {
  //   if (filters.isMimeJpeg(type)) {
  //     exif.load(urlFromFilename(filename), (error, exifData) => {
  //       if (error) {
  //         console.warn('could not read exif for:', filename, error);
  //       }
  //       let orientation = exifData && exifData.image ? (exifData.image.Orientation || 0) : 0;
  //       for (let i = 0; i < orientationREs.length; ++i) {
  //         if (orientationREs[i].test(orientation)) {
  //           orientation = i + 1;
  //           break;
  //         }
  //       }
  //
  //       resolve({orientation: orientation | 0}); // convert string to number by | 0 vs parseInt which returns NaN for bad values
  //     });
  //   } else {
  //     resolve({orientation: 0});
  //   }
  // });
}

