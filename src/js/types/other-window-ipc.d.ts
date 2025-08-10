declare module 'other-window-ipc' {
  export interface Channel {
    on(event: string, listener: (...args: any[]) => void): void;
    close(): void;
  }

  export interface ChannelStream {
    on(event: string, listener: (...args: any[]) => void): void;
    send(event: string, ...args: any[]): void;
    close(): void;
  }

  export function createChannel(name: string): Channel;
  export function createChannelStream(name: string): Promise<ChannelStream>;
}
