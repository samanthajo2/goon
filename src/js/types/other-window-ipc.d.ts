declare module 'other-window-ipc' {
  export interface Channel {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, listener: (...args: any[]) => void): void;
    close(): void;
  }

  export interface ChannelStream {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, listener: (...args: any[]) => void): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send(event: string, ...args: any[]): void;
    close(): void;
  }

  export function createChannel(name: string): Channel;
  export function createChannelStream(name: string): Promise<ChannelStream>;
}
