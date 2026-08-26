/*
  Drop-in replacement for other-window-ipc using Electron's built-in IPC.

  Main process: call initRelay() at startup.
  Renderer: use createChannel() and createChannelStream().
*/

import { EventEmitter } from 'node:events';
import electron from './electron-imports.js';
import { extractBinaries } from './binary-args.js';

const P = 'wipc:';

// ── Types ──

export interface ChannelStream {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeListener(event: string, listener: (...args: any[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(event: string, ...args: any[]): void;
  close(): void;
}

export interface Channel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this;
  close(): void;
}

// ── Renderer state (declared before Stream since methods reference ipcSend) ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ipcSend: (channel: string, ...args: any[]) => void;

// ── Stream ──

class Stream extends EventEmitter implements ChannelStream {
  private _closed = false;
  remoteWindowId = 0;
  remoteStreamId = 0;

  constructor(
    readonly localId: number,
    private readonly _remove: () => void,
  ) {
    super();
  }

  send(event: string, ...args: unknown[]): void {
    if (this._closed) return;
    ipcSend(`${P}relay`, this.remoteWindowId, this.remoteStreamId, event, ...args);
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    if (this.remoteStreamId) {
      ipcSend(`${P}disconnect`, this.remoteWindowId, this.remoteStreamId);
    }
    this._remove();
  }

  handleDisconnect(): void {
    if (this._closed) return;
    this._closed = true;
    this._remove();
    this.emit('disconnect');
  }
}

let nextId = 1;
const streams = new Map<number, Stream>();
const channelMap = new Map<string, EventEmitter>();
const pending = new Map<number, {
  stream: Stream;
  channelId: string;
  resolve: (s: ChannelStream) => void;
  reject: (err: unknown) => void;
}>();

let inited = false;

function init(): void {
  if (inited) return;
  inited = true;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ipcRenderer } = require('electron');
  ipcSend = (ch, ...args) => ipcRenderer.send(ch, ...args);

  // Relay message for one of our streams
  ipcRenderer.on(`${P}relay`, (_e: unknown, localStreamId: number, event: string, ...args: unknown[]) => {
    const s = streams.get(localStreamId);
    if (s) process.nextTick(() => s.emit(event, ...args));
  });

  // Remote disconnected
  ipcRenderer.on(`${P}disconnect`, (_e: unknown, localStreamId: number) => {
    const s = streams.get(localStreamId);
    if (s) {
      streams.delete(localStreamId);
      s.handleDisconnect();
    }
  });

  // Another renderer wants to connect to our channel
  ipcRenderer.on(`${P}connect`, (_e: unknown, remoteWindowId: number, remoteStreamId: number, channelId: string) => {
    const ch = channelMap.get(channelId);
    if (!ch) {
      ipcSend(`${P}connectResult`, remoteWindowId, remoteStreamId, false, 0);
      return;
    }
    const localId = nextId++;
    const s = new Stream(localId, () => streams.delete(localId));
    s.remoteWindowId = remoteWindowId;
    s.remoteStreamId = remoteStreamId;
    streams.set(localId, s);
    ipcSend(`${P}connectResult`, remoteWindowId, remoteStreamId, true, localId);
    ch.emit('connect', s);
  });

  // Result of our connect attempt
  ipcRenderer.on(`${P}connectResult`, (_e: unknown, localStreamId: number, success: boolean, remoteStreamId: number) => {
    const p = pending.get(localStreamId);
    if (!p) return;
    pending.delete(localStreamId);
    if (success) {
      p.stream.remoteStreamId = remoteStreamId;
      streams.set(localStreamId, p.stream);
      p.resolve(p.stream);
    } else {
      p.reject(new Error(`Could not connect to channel: ${p.channelId}`));
    }
  });

  // Main tells us target window for a channel
  ipcRenderer.on(`${P}target`, (_e: unknown, localStreamId: number, targetWindowId: number, channelId: string) => {
    const p = pending.get(localStreamId);
    if (!p) return;
    p.stream.remoteWindowId = targetWindowId;
    ipcSend(`${P}connect`, targetWindowId, localStreamId, channelId);
  });

  // Channel not found
  ipcRenderer.on(`${P}notFound`, (_e: unknown, localStreamId: number, channelId: string) => {
    const p = pending.get(localStreamId);
    if (!p) return;
    pending.delete(localStreamId);
    p.reject(new Error(`No channel: ${channelId}`));
  });
}

// ── Public renderer API ──

export function createChannel(channelId: string): Channel {
  init();
  if (channelMap.has(channelId)) {
    throw new Error(`Channel already in use: ${channelId}`);
  }
  const ch = new EventEmitter();
  channelMap.set(channelId, ch);
  ipcSend(`${P}register`, channelId);
  const channel: Channel = {
    on: (event: string, listener: (...args: unknown[]) => void) => { ch.on(event, listener); return channel; },
    close: () => {
      ipcSend(`${P}unregister`, channelId);
      channelMap.delete(channelId);
    },
  };
  return channel;
}

export function createChannelStream(channelId: string): Promise<ChannelStream> {
  init();
  return new Promise((resolve, reject) => {
    const localId = nextId++;
    const s = new Stream(localId, () => streams.delete(localId));
    pending.set(localId, { stream: s, channelId, resolve, reject });
    ipcSend(`${P}getTarget`, localId, channelId);
    setTimeout(() => {
      if (pending.has(localId)) {
        pending.delete(localId);
        reject(new Error(`Timeout connecting to channel: ${channelId}`));
      }
    }, 10000);
  });
}

// ── Main process relay ──

// Sentinel windowId used to make main itself a peer in the existing
// connect/relay protocol. Real Electron webContents IDs start at 1 and are
// never negative, so -1 is safe.
const MAIN_SENDER_ID = -1;

// Sentinel owner id meaning "this channel is served by main itself" rather than
// by a renderer. Deliberately distinct from MAIN_SENDER_ID so the relay can tell
// "the peer is main" (a bridged browser socket) apart from "the owner is main".
const MAIN_CHANNEL_ID = -2;

// A WebSocket-like duck type — lets ws-bridge.ts wire up `ws` without this
// module having to import the `ws` package (keeping it usable in renderer
// bundles too).
export type WebSocketLike = {
  send(data: string): void;
  sendBinary(data: ArrayBuffer): void;
  close(): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
};

// State for browser-originated streams that main is bridging to a renderer.
const bridgeStreams = new Map<number, BridgeStream>();
let bridgeNextId = 1;
const ownersRef: { value: Map<string, number> | null } = { value: null };

class BridgeStream {
  peerWindowId: number | null = null;
  peerStreamId: number | null = null;
  private _closed = false;

  constructor(
    public readonly localId: number,
    private readonly _ws: WebSocketLike,
  ) {
    this._ws.onMessage((data) => this._onWsMessage(data));
    this._ws.onClose(() => this._onWsClose());
  }

  private _onWsMessage(data: string): void {
    if (this._closed) return;
    if (this.peerWindowId == null || this.peerStreamId == null) return;
    let msg: { event?: string; args?: unknown[] };
    try { msg = JSON.parse(data); } catch { return; }
    if (typeof msg.event !== 'string') return;
    electron.webContents.fromId(this.peerWindowId)
      ?.send(`${P}relay`, this.peerStreamId, msg.event, ...(msg.args ?? []));
  }

  // Forward a `relay` event coming from the peer renderer down to the browser.
  // Args may contain binary values (Uint8Array / Buffer / ArrayBuffer); we
  // pull them out into separate WS binary frames following the JSON frame.
  forwardToWs(event: string, args: unknown[]): void {
    if (this._closed) return;
    const { jsonArgs, binaries } = extractBinaries(args);
    try {
      this._ws.send(JSON.stringify({ event, args: jsonArgs }));
      for (const bin of binaries) this._ws.sendBinary(bin);
    } catch { /* socket may be closed */ }
  }

  // Browser closed the WebSocket: tell the peer renderer.
  private _onWsClose(): void {
    if (this._closed) return;
    this._closed = true;
    if (this.peerWindowId != null && this.peerStreamId != null) {
      electron.webContents.fromId(this.peerWindowId)?.send(`${P}disconnect`, this.peerStreamId);
    }
    bridgeStreams.delete(this.localId);
  }

  // Peer renderer closed: close the WebSocket too.
  handlePeerDisconnect(): void {
    if (this._closed) return;
    this._closed = true;
    try { this._ws.close(); } catch { /* already closed */ }
    bridgeStreams.delete(this.localId);
  }
}

/**
 * Accept a browser WebSocket as a new connection to a registered channel.
 * Main acts as a virtual peer in the existing connect protocol — the
 * channel-owning renderer doesn't need to know whether the originating
 * peer is another renderer or a browser.
 */
export function acceptWebSocketConnection(ws: WebSocketLike, channelId: string): void {
  if (!ownersRef.value) {
    ws.close();
    return;
  }
  const ownerId = ownersRef.value.get(channelId);
  if (ownerId === undefined) {
    ws.close();
    return;
  }
  if (ownerId === MAIN_CHANNEL_ID) {
    // Served by main: no renderer hop, so drive the stream straight off the socket.
    const stream = acceptMainChannelPeer(channelId, webSocketPeer(ws), null);
    if (!stream) {
      ws.close();
      return;
    }
    ws.onMessage((data) => {
      let msg: { event?: string; args?: unknown[] };
      try { msg = JSON.parse(data); } catch { return; }
      if (typeof msg.event !== 'string') return;
      stream.emit(msg.event, ...(msg.args ?? []));
    });
    ws.onClose(() => stream.handleDisconnect());
    return;
  }
  const wc = electron.webContents.fromId(ownerId);
  if (!wc) {
    ws.close();
    return;
  }
  const localId = bridgeNextId++;
  const stream = new BridgeStream(localId, ws);
  bridgeStreams.set(localId, stream);
  // Send connect IPC directly to the owner. The owner will respond with a
  // connectResult IPC routed back at us (intercepted in initRelay below).
  wc.send(`${P}connect`, MAIN_SENDER_ID, localId, channelId);
}

// ── Main-process channel hosting ──

// A peer connected to a main-hosted channel. Two flavours: a renderer, reached
// over the same relay IPC that renderer-to-renderer streams use, and a browser
// WebSocket, reached directly with binary args split into their own frames.
type MainPeer = {
  deliver(event: string, args: unknown[]): void;
  close(): void;
};

function rendererPeer(webContentsId: number, peerStreamId: number): MainPeer {
  return {
    deliver(event, args) {
      electron.webContents.fromId(webContentsId)?.send(`${P}relay`, peerStreamId, event, ...args);
    },
    close() {
      electron.webContents.fromId(webContentsId)?.send(`${P}disconnect`, peerStreamId);
    },
  };
}

function webSocketPeer(ws: WebSocketLike): MainPeer {
  return {
    deliver(event, args) {
      const { jsonArgs, binaries } = extractBinaries(args);
      try {
        ws.send(JSON.stringify({ event, args: jsonArgs }));
        for (const bin of binaries) ws.sendBinary(bin);
      } catch { /* socket may be closed */ }
    },
    close() {
      try { ws.close(); } catch { /* already closed */ }
    },
  };
}

const mainChannels = new Map<string, EventEmitter>();
const mainStreams = new Map<number, MainStream>();
let mainNextId = 1;
// initRelay owns the `owners` map and the waiting-connection flush. Capture the
// flush so a channel registered after a client already asked for it still
// unblocks that client instead of letting it time out.
const flushRef: { value: (() => void) | null } = { value: null };

class MainStream extends EventEmitter implements ChannelStream {
  private _closed = false;

  constructor(
    readonly localId: number,
    readonly channelId: string,
    private readonly _peer: MainPeer,
    // Set for renderer peers so streams can be reaped when the window goes away.
    readonly peerWebContentsId: number | null,
  ) {
    super();
  }

  send(event: string, ...args: unknown[]): void {
    if (this._closed) return;
    this._peer.deliver(event, args);
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    mainStreams.delete(this.localId);
    this._peer.close();
  }

  // The peer went away: renderer disconnected, socket closed, or window destroyed.
  handleDisconnect(): void {
    if (this._closed) return;
    this._closed = true;
    mainStreams.delete(this.localId);
    this.emit('disconnect');
  }
}

function acceptMainChannelPeer(channelId: string, peer: MainPeer, peerWebContentsId: number | null): MainStream | null {
  const ch = mainChannels.get(channelId);
  if (!ch) return null;
  const stream = new MainStream(mainNextId++, channelId, peer, peerWebContentsId);
  mainStreams.set(stream.localId, stream);
  ch.emit('connect', stream);
  return stream;
}

/**
 * Register a channel served by the main process. Mirrors the renderer's
 * createChannel(): the returned Channel emits 'connect' with a ChannelStream per
 * peer, and peers reach it through the ordinary createChannelStream(channelId) --
 * neither renderers nor browser clients can tell who is serving it.
 */
export function createMainChannel(channelId: string): Channel {
  if (!ownersRef.value) {
    throw new Error('createMainChannel: call initRelay() first');
  }
  if (mainChannels.has(channelId) || ownersRef.value.has(channelId)) {
    throw new Error(`Channel already in use: ${channelId}`);
  }
  const ch = new EventEmitter();
  mainChannels.set(channelId, ch);
  ownersRef.value.set(channelId, MAIN_CHANNEL_ID);
  flushRef.value?.();
  const channel: Channel = {
    on: (event: string, listener: (...args: unknown[]) => void) => { ch.on(event, listener); return channel; },
    close: () => {
      mainChannels.delete(channelId);
      if (ownersRef.value?.get(channelId) === MAIN_CHANNEL_ID) ownersRef.value.delete(channelId);
      for (const s of [...mainStreams.values()]) {
        if (s.channelId === channelId) s.close();
      }
    },
  };
  return channel;
}

export function initRelay(): void {
  const { ipcMain, webContents, app } = electron;

  const owners = new Map<string, number>();
  ownersRef.value = owners;
  const waiting: { senderId: number; localStreamId: number; channelId: string }[] = [];

  flushRef.value = () => flush();

  function flush(): void {
    for (let i = waiting.length - 1; i >= 0; i--) {
      const r = waiting[i];
      const targetId = owners.get(r.channelId);
      if (targetId !== undefined) {
        waiting.splice(i, 1);
        webContents.fromId(r.senderId)?.send(`${P}target`, r.localStreamId, targetId, r.channelId);
      }
    }
  }

  ipcMain.on(`${P}register`, (e: Electron.IpcMainEvent, channelId: string) => {
    owners.set(channelId, e.sender.id);
    flush();
  });

  ipcMain.on(`${P}unregister`, (e: Electron.IpcMainEvent, channelId: string) => {
    if (owners.get(channelId) === e.sender.id) owners.delete(channelId);
  });

  ipcMain.on(`${P}getTarget`, (e: Electron.IpcMainEvent, localStreamId: number, channelId: string) => {
    const targetId = owners.get(channelId);
    if (targetId !== undefined) {
      e.sender.send(`${P}target`, localStreamId, targetId, channelId);
    } else {
      waiting.push({ senderId: e.sender.id, localStreamId, channelId });
      setTimeout(() => {
        const idx = waiting.findIndex(r => r.senderId === e.sender.id && r.localStreamId === localStreamId);
        if (idx >= 0) {
          waiting.splice(idx, 1);
          webContents.fromId(e.sender.id)?.send(`${P}notFound`, localStreamId, channelId);
        }
      }, 10000);
    }
  });

  ipcMain.on(`${P}connect`, (e: Electron.IpcMainEvent, targetWindowId: number, senderStreamId: number, channelId: string) => {
    if (targetWindowId === MAIN_CHANNEL_ID) {
      const stream = acceptMainChannelPeer(channelId, rendererPeer(e.sender.id, senderStreamId), e.sender.id);
      e.sender.send(`${P}connectResult`, senderStreamId, !!stream, stream ? stream.localId : 0);
      return;
    }
    webContents.fromId(targetWindowId)?.send(`${P}connect`, e.sender.id, senderStreamId, channelId);
  });

  ipcMain.on(`${P}connectResult`, (e: Electron.IpcMainEvent, targetWindowId: number, remoteStreamId: number, success: boolean, localStreamId: number) => {
    if (targetWindowId === MAIN_SENDER_ID) {
      // The peer was main itself (a WS bridge stream). Wire it up.
      const stream = bridgeStreams.get(remoteStreamId);
      if (!stream) return;
      if (!success) {
        stream.handlePeerDisconnect();
        return;
      }
      stream.peerWindowId = e.sender.id;
      stream.peerStreamId = localStreamId;
      return;
    }
    webContents.fromId(targetWindowId)?.send(`${P}connectResult`, remoteStreamId, success, localStreamId);
  });

  ipcMain.on(`${P}relay`, (_e: Electron.IpcMainEvent, targetWindowId: number, remoteStreamId: number, event: string, ...args: unknown[]) => {
    if (targetWindowId === MAIN_SENDER_ID) {
      bridgeStreams.get(remoteStreamId)?.forwardToWs(event, args);
      return;
    }
    if (targetWindowId === MAIN_CHANNEL_ID) {
      mainStreams.get(remoteStreamId)?.emit(event, ...args);
      return;
    }
    webContents.fromId(targetWindowId)?.send(`${P}relay`, remoteStreamId, event, ...args);
  });

  ipcMain.on(`${P}disconnect`, (_e: Electron.IpcMainEvent, targetWindowId: number, remoteStreamId: number) => {
    if (targetWindowId === MAIN_SENDER_ID) {
      bridgeStreams.get(remoteStreamId)?.handlePeerDisconnect();
      return;
    }
    if (targetWindowId === MAIN_CHANNEL_ID) {
      mainStreams.get(remoteStreamId)?.handleDisconnect();
      return;
    }
    webContents.fromId(targetWindowId)?.send(`${P}disconnect`, remoteStreamId);
  });

  // Clean up on renderer destroy
  app.on('web-contents-created', (_event: unknown, wc: Electron.WebContents) => {
    wc.on('destroyed', () => {
      for (const [channelId, ownerId] of owners) {
        if (ownerId === wc.id) owners.delete(channelId);
      }
      for (const s of [...mainStreams.values()]) {
        if (s.peerWebContentsId === wc.id) s.handleDisconnect();
      }
      for (let i = waiting.length - 1; i >= 0; i--) {
        if (waiting[i].senderId === wc.id) waiting.splice(i, 1);
      }
    });
  });
}
