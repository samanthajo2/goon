/*
  WebSocket bridge for browser-based "view" clients.

  Runs in main process. When the optional web server is enabled, browsers
  open a WebSocket to /ws?channel=<channelId>. We adapt the WebSocket to a
  WebSocketLike duck type and hand it to acceptWebSocketConnection() in
  window-ipc.ts, which then bridges the connection to the renderer that
  owns the channel — using the same connect/relay protocol that desktop
  windows already use.

  The wire format on the WS is JSON: { event: string, args: unknown[] }.
  Binary payloads (e.g. archive-decompressed media) aren't supported here
  yet; that comes when we add the web platform's mediaManager handling.
*/

import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { acceptWebSocketConnection, type WebSocketLike } from '../lib/window-ipc.js';

function adapt(ws: WebSocket): WebSocketLike {
  return {
    send(data: string) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    },
    onMessage(handler) {
      ws.on('message', (data) => handler(data.toString()));
    },
    onClose(handler) {
      ws.on('close', handler);
      ws.on('error', handler);
    },
  };
}

export function startWebSocketBridge(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const channelId = url.searchParams.get('channel');
    if (!channelId) {
      ws.close(1002, 'missing channel');
      return;
    }
    acceptWebSocketConnection(adapt(ws), channelId);
  });
  return wss;
}

export function stopWebSocketBridge(wss: WebSocketServer): void {
  wss.close();
}
