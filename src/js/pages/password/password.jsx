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

import React from 'react';
import { render as reactRender } from 'react-dom';
import {ipcRenderer} from 'electron';  // eslint-disable-line
import crypto from 'crypto';
import stacktraceLog from '../../lib/stacktrace-log.js';  // eslint-disable-line
import '../../lib/title';
import {cssArray} from '../../lib/css-utils';
import {checkPassword} from '../../lib/password-utils';
import Modal from '../../lib/ui/modal';

// const isDevMode = process.env.NODE_ENV === 'development';

class Password extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      error: false,
    };
  }
  componentDidMount() {
    // no idea why but autoFocus didn't work
    // neither did ref={(input) => { if (input) { input.focus(); }}
    this.input.focus();
  }
  render() {
    return (
      <Modal>
        <div className={(cssArray('msg').addIf(this.state.error, 'error'))}>
          <div>Password</div>
          <input
            type="password"
            ref={(input) => { this.input = input; }}
            onKeyPress={(event) => {
              if (event.key === 'Enter') {
                checkPassword(crypto, this.props.password, event.target.value.trim(), (isMatch) => {
                  if (isMatch) {
                    ipcRenderer.send('unlock');
                  } else {
                    this.setState({
                      error: true,
                    });
                  }
                });
              }
            }}
          />
        </div>
      </Modal>
    );
  }
}

ipcRenderer.on('password', (event, password) => {
  reactRender(
    <Password password={password} />,
    document.querySelector('.browser')
  );
});
ipcRenderer.send('getPassword');

