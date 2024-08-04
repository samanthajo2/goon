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
import _ from 'lodash';
import crypto from 'crypto';
import bind from '../../lib/bind';
import {hashPassword} from '../../lib/password-utils';
import Modal from '../../lib/ui/modal';

class PasswordInput extends React.Component {
  constructor(props) {
    super(props);
    bind(
      this,
      '_setPassword',
    );
  }
  componentDidMount() {
    // no idea why but autoFocus didn't work
    // neither did ref={(input) => { if (input) { input.focus(); }}
    this._input.focus();
  }
  _setPassword() {
    this.props.setPassword(this._input.value.trim());
  }
  render() {
    return (
      <div>
        <input
          ref={(input) => { this._input = input; }}
          type="password"
        />
        <button type="button" onClick={this._setPassword}>Set</button>
        <button type="button" onClick={this.props.cancelPassword}>Cancel</button>
        <button type="button" onClick={this.props.clearPassword}>Clear</button>
      </div>
    );
  }
}

export default class LivePasswordEditor extends React.Component {
  constructor(props) {
    super(props);
    bind(
      this,
      '_setPassword',
      '_cancel',
      '_editPassword',
      '_clearPassword',
    );
    this.state = {
      editing: false,
    };
    _.debounce(this._setPassword, 250);
  }
  _cancel() {
    this.setState({
      editing: false,
    });
  }
  _clearPassword() {
    this.props.onChange('');
    this._cancel();
  }
  _setPassword(password) {
    if (password.length) {
      hashPassword(crypto, password, this.props.onChange);
    } else {
      this.props.onChange('');
    }
    this._cancel();
  }
  _editPassword() {
    this.setState({
      editing: true,
    });
  }
  render() {
    const {hasPassword} = this.props;
    const {editing} = this.state;
    if (editing) {
      return (
        <Modal>
          <div>
            <div>Enter a password</div>
            <PasswordInput
              setPassword={this._setPassword}
              clearPassword={this._clearPassword}
              cancel={this._cancel}
            />
          </div>
        </Modal>
      );
    }
    if (!hasPassword) {
      return (
        <div>
          <button type="button" onClick={this._editPassword}>Set</button>
        </div>
      );
    } else {
      return (
        <div>
          <div>Password: ********</div>
          <button type="button" onClick={this._editPassword}>Edit</button>
        </div>
      );
    }
  }
}

