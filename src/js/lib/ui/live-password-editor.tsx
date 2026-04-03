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

import React, { useEffect, useRef, useState } from 'react';
import crypto from 'crypto';
import { hashPassword } from '../password-utils';
import Modal from './modal';

interface PasswordInputProps {
  setPassword: (password: string) => void;
  cancelPassword: () => void;
  clearPassword: () => void;
}

function PasswordInput({ setPassword, cancelPassword, clearPassword }: PasswordInputProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // autoFocus is unreliable here; focus manually after mount.
    inputRef.current?.focus();
  }, []);

  const handleSet = (): void => {
    setPassword(inputRef.current?.value.trim() ?? '');
  };

  return (
    <div>
      <input ref={inputRef} type="password" />
      <button type="button" onClick={handleSet}>Set</button>
      <button type="button" onClick={cancelPassword}>Cancel</button>
      <button type="button" onClick={clearPassword}>Clear</button>
    </div>
  );
}

interface LivePasswordEditorProps {
  hasPassword: boolean;
  onChange: (hash: string) => void;
}

export default function LivePasswordEditor({ hasPassword, onChange }: LivePasswordEditorProps): React.ReactElement {
  const [editing, setEditing] = useState(false);

  const cancel = (): void => setEditing(false);

  const clearPassword = (): void => {
    onChange('');
    cancel();
  };

  const setPassword = (password: string): void => {
    if (password.length) {
      hashPassword(crypto, password, onChange);
    } else {
      onChange('');
    }
    cancel();
  };

  if (editing) {
    return (
      <Modal>
        <div>
          <div>Enter a password</div>
          <PasswordInput
            setPassword={setPassword}
            cancelPassword={cancel}
            clearPassword={clearPassword}
          />
        </div>
      </Modal>
    );
  }

  if (!hasPassword) {
    return (
      <div>
        <button type="button" onClick={() => setEditing(true)}>Set</button>
      </div>
    );
  }

  return (
    <div>
      <div>Password: ********</div>
      <button type="button" onClick={() => setEditing(true)}>Edit</button>
    </div>
  );
}
