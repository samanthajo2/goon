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

type CryptoAPI = {
  pbkdf2: (
    password: string | Buffer,
    salt: string | Buffer,
    iterations: number,
    keylen: number,
    digest: string,
    callback: (err: Error | null, derivedKey: Buffer) => void
  ) => void;
  randomBytes: (size: number, callback: (err: Error | null, buf: Buffer) => void) => void;
};

function genPassword(crypto: CryptoAPI, password: string, salt: string, iterations: number, callback: (hash: string) => void) {
  crypto.pbkdf2(password, salt, iterations, 64, 'sha512', (err, derivedKey) => {
    if (err) {
      throw new Error('WTF!');
    }
    callback(`${iterations}:${salt}:${derivedKey.toString('hex')}`);
  });
}

function isEmpty(s: string | undefined): boolean {
  return s === undefined || s.trim() === '';
}

function passwordsMatch(savedPassword: string | undefined, testPassword: string | undefined): boolean {
  return (isEmpty(savedPassword) && isEmpty(testPassword)) ||
    savedPassword === testPassword;
}

function checkPassword(crypto: CryptoAPI, savedPassword: string, enteredPassword: string | undefined, callback: (match: boolean) => void) {
  if (isEmpty(enteredPassword)) {
    process.nextTick(() => {
      callback(isEmpty(savedPassword));
    });
    return;
  }
  const [iterations, salt] = savedPassword.split(':');
  genPassword(crypto, enteredPassword!, salt, parseInt(iterations ?? '0'), (hash) => {
    callback(passwordsMatch(hash, savedPassword));
  });
}

function hashPassword(crypto: CryptoAPI, password: string, callback: (hash: string) => void) {
  crypto.randomBytes(32, (err, salt) => {
    if (err) {
      throw new Error('WAT!');
    }
    genPassword(crypto, password, salt.toString('hex'), 100000, callback);
  });
}

export {
  checkPassword,
  passwordsMatch,
  hashPassword,
};
