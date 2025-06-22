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

type AppPaths = {
  homeDir: string,
  appDataDir: string,
  localAppDataDir: string,
}
const appPaths: AppPaths = {
  homeDir: 'unset',
  appDataDir: 'unset',
  localAppDataDir: 'unset',
};
if (process.platform.toLowerCase() === 'darwin') {
  appPaths.homeDir         = process.env.HOME!;
  appPaths.appDataDir      = path.join(process.env.HOME!, 'Library', 'Application Support');
  appPaths.localAppDataDir = appPaths.appDataDir;
} else if (process.platform.substring(0, 3).toLowerCase() === 'win') {
  appPaths.homeDir         = process.env.USERPROFILE!;
  appPaths.appDataDir      = process.env.APPDATA!;
  appPaths.localAppDataDir = process.env.LOCALAPPDATA || process.env.APPDATA!;
} else {
  appPaths.homeDir         = process.env.HOME!;
  appPaths.appDataDir      = process.env.HOME!;
  appPaths.localAppDataDir = appPaths.appDataDir;
}
export default appPaths;
