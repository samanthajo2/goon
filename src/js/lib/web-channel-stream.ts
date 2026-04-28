/*
  Browser-side ChannelStream implementation backed by a native WebSocket.

  Mirrors the shape of the Electron-IPC Stream class in window-ipc.ts so the
  view code can use either transport without caring which it has.

  Wire format (matches main/ws-bridge.ts on the server side):
    { event: string, args: unknown[] }

  Connections are scoped to a single channel — one WebSocket per channel.
  That keeps the protocol trivial; we don't multiplex, so closing the WS is
  always the same as closing the channel.
*/

import type { ChannelStream } from './window-ipc.js';

type Listener = (...args: unknown[]) => void;

// Constructed only by the factory below, which awaits OPEN before exposing
// the stream — so all calls into send/on/etc. happen on an already-open
// socket. No need to buffer pre-open sends.
class WebChannelStream implements ChannelStream {
  private _listeners = new Map<string, Set<Listener>>();
  private _closed = false;

  constructor(private readonly _ws: WebSocket) {
    _ws.addEventListener('message', (e: MessageEvent<string>) => {
      let msg: { event?: string; args?: unknown[] };
      try { msg = JSON.parse(e.data); } catch { return; }
      if (typeof msg.event !== 'string') return;
      const listeners = this._listeners.get(msg.event);
      if (!listeners) return;
      // Snapshot to tolerate listeners removing themselves during dispatch.
      for (const fn of [...listeners]) fn(...(msg.args ?? []));
    });
    _ws.addEventListener('close', () => this._handleDisconnect());
    _ws.addEventListener('error', () => this._handleDisconnect());
  }

  on(event: string, fn: Listener): this {
    let s = this._listeners.get(event);
    if (!s) { s = new Set(); this._listeners.set(event, s); }
    s.add(fn);
    return this;
  }

  removeListener(event: string, fn: Listener): this {
    this._listeners.get(event)?.delete(fn);
    return this;
  }

  send(event: string, ...args: unknown[]): void {
    if (this._closed) return;
    this._ws.send(JSON.stringify({ event, args }));
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    if (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING) {
      this._ws.close();
    }
  }

  private _handleDisconnect(): void {
    if (this._closed) return;
    this._closed = true;
    const listeners = this._listeners.get('disconnect');
    if (listeners) for (const fn of [...listeners]) fn();
  }
}

/**
 * Open a ChannelStream over WebSocket. Resolves once the socket is OPEN.
 * Default URL is `ws[s]://<host>/ws?channel=<id>` based on the page origin.
 */
export function createWebChannelStream(channelId: string, baseUrl?: string): Promise<ChannelStream> {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = baseUrl ?? `${proto}//${location.host}/ws?channel=${encodeURIComponent(channelId)}`;
  const ws = new WebSocket(url);
  return new Promise<ChannelStream>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(new WebChannelStream(ws)), { once: true });
    ws.addEventListener('error', () => reject(new Error(`Failed to open WebSocket to channel: ${channelId}`)), { once: true });
    ws.addEventListener('close', () => reject(new Error(`WebSocket closed before open: ${channelId}`)), { once: true });
  });
}
