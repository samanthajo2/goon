/*
  "Browser server" window — lets the user start/stop the optional HTTP
  server (the one that serves the view page over the network), see the
  URL(s) the server is reachable at, copy them, open them in the system
  browser, and scan them as a QR code from a phone.

  This is a thin UI that talks to the main process via ipcRenderer:
    - 'browser:getServerState'  → { running, port, urls }
    - 'browser:startServer'
    - 'browser:stopServer'
    - 'browser:state' (broadcast from main when it changes)
*/

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ipcRenderer, shell } from '../../lib/electron-imports.js';
import { QrCode, Ecc } from '../../lib/qrcodegen.js';
import '../../lib/stacktrace-log.js';
import '../../lib/title.js';

type ServerState = {
  running: boolean;
  port: number;
  urls: string[];
};

type Props = Record<string, never>;

type State = {
  server: ServerState;
};

function qrCodeSvg(text: string, sizePx: number): React.ReactElement {
  const qr = QrCode.encodeText(text, Ecc.MEDIUM);
  const padding = 3;
  const total = qr.size + padding * 2;
  const cells: React.ReactElement[] = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) {
        cells.push(<rect key={`${x},${y}`} x={x + padding} y={y + padding} width={1} height={1} />);
      }
    }
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${total} ${total}`}
      width={sizePx}
      height={sizePx}
      shapeRendering="crispEdges"
      style={{ background: '#fff' }}
    >
      <rect width={total} height={total} fill="#fff" />
      <g fill="#000">{cells}</g>
    </svg>
  );
}

class Browser extends React.Component<Props, State> {
  state: State = {
    server: { running: false, port: 0, urls: [] },
  };

  private _onState = (_e: unknown, server: ServerState): void => {
    this.setState({ server });
  };

  componentDidMount(): void {
    ipcRenderer.on('browser:state', this._onState);
    ipcRenderer.invoke('browser:getServerState').then((server: ServerState) => {
      this.setState({ server });
    });
  }

  componentWillUnmount(): void {
    ipcRenderer.removeListener('browser:state', this._onState);
  }

  private _toggle = (): void => {
    if (this.state.server.running) {
      ipcRenderer.send('browser:stopServer');
    } else {
      ipcRenderer.send('browser:startServer');
    }
  };

  private _launch = (url: string): void => {
    shell.openExternal(url);
  };

  private _copy = (url: string): void => {
    navigator.clipboard.writeText(url).catch((err) => { console.error(err); });
  };

  render(): React.ReactNode {
    const { running, urls } = this.state.server;
    // The "primary" URL we feature with QR code: prefer a non-loopback so
    // a phone on the same wifi can reach it. Loopback is the fallback.
    const primary = urls.find(u => !/\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(u)) ?? urls[0];
    return (
      <div className="msg browser-server">
        <h1>Browser Server</h1>
        <div className="row">
          <button type="button" onClick={this._toggle}>
            {running ? 'Stop Server' : 'Start Server'}
          </button>
          <span className="status">{running ? `running on port ${this.state.server.port}` : 'stopped'}</span>
        </div>
        {running && primary && (
          <>
            <div className="qr">{qrCodeSvg(primary, 240)}</div>
            <div className="urls">
              {urls.map((url) => (
                <div key={url} className="url-row">
                  <code>{url}</code>
                  <button type="button" onClick={() => { this._launch(url); }}>Launch Browser</button>
                  <button type="button" onClick={() => { this._copy(url); }}>Copy</button>
                </div>
              ))}
            </div>
          </>
        )}
        {running && !primary && (
          <div className="status">server is starting…</div>
        )}
      </div>
    );
  }
}

createRoot(document.querySelector('.browser')!).render(<Browser />);
