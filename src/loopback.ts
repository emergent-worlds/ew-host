/** E16/PV87: an installed build authenticates its one local socket before speaking the host contract. */
import type { Transport } from './bridge.js';

export const SOCKET_FRAME_BYTES = 4 * 1024 * 1024;
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}
export interface LoopbackOptions {
  /** Injectable socket only for a host adapter or local deterministic test. */
  socket?: (url: string) => SocketLike;
  signal?: AbortSignal;
}

/** Connect only to the launcher's loopback endpoint. The token never enters the URL or an error. */
export function loopbackTransport(url: string, token: string, options: LoopbackOptions = {}): Promise<Transport> {
  let address: URL;
  try { address = new URL(url); } catch { return Promise.reject(new Error('invalid loopback address')); }
  if (address.protocol !== 'ws:' || address.hostname !== '127.0.0.1' || !address.port || address.username || address.password || address.search || address.hash) return Promise.reject(new Error('expected a loopback WebSocket address'));
  if (!token || new TextEncoder().encode(JSON.stringify({ token })).byteLength > SOCKET_FRAME_BYTES) return Promise.reject(new Error('invalid launch token'));
  if (options.signal?.aborted) return Promise.reject(new Error('loopback connection cancelled'));
  return new Promise((resolve, reject) => {
    let socket: SocketLike;
    try { socket = options.socket ? options.socket(address.href) : new WebSocket(address.href); }
    catch { reject(new Error('loopback connection failed')); return; }
    const listeners = new Set<(m: unknown) => void>();
    const closeListeners = new Set<(error: Error) => void>();
    let closeError = new Error('loopback connection closed');
    const queued: { message: unknown; bytes: number }[] = [];
    let queuedBytes = 0;
    let opened = false;
    let closed = false;
    const stop = (reason = new Error('loopback connection closed')) => {
      if (closed) return;
      closed = true;
      closeError = reason;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      socket.removeEventListener('open', open);
      socket.removeEventListener('message', message);
      socket.removeEventListener('error', error);
      socket.removeEventListener('close', ended);
      listeners.clear(); queued.length = 0; queuedBytes = 0;
      socket.close();
      for (const listener of [...closeListeners]) listener(reason);
      closeListeners.clear();
    };
    const fail = (why: string) => { const reason = new Error(why); stop(reason); reject(reason); };
    const abort = () => fail('loopback connection cancelled');
    const error = () => fail('loopback connection failed');
    const ended = () => fail('loopback connection closed');
    const timer = setTimeout(() => fail('loopback connection timed out'), 30_000);
    function message(event: { data: unknown }) {
      if (closed) return;
      if (typeof event.data !== 'string') return fail('expected a JSON text frame');
      const bytes = new TextEncoder().encode(event.data).byteLength;
      if (bytes > SOCKET_FRAME_BYTES) return fail('socket frame exceeds its limit');
      let value: unknown;
      try { value = JSON.parse(event.data); } catch { return fail('invalid JSON frame'); }
      if (listeners.size) for (const listener of listeners) listener(value);
      else {
        if (queuedBytes + bytes > SOCKET_FRAME_BYTES || queued.length >= 1000) return fail('unread socket data exceeds its limit');
        queued.push({ message: value, bytes }); queuedBytes += bytes;
      }
    }
    function open() {
      if (closed || opened) return;
      opened = true;
      try { socket.send(JSON.stringify({ token })); } catch { return fail('loopback authentication could not be sent'); }
      clearTimeout(timer);
      resolve({
        send(value) {
          if (closed || socket.readyState !== 1) throw new Error('loopback connection closed');
          const data = JSON.stringify(value);
          if (typeof data !== 'string') throw new Error('expected a JSON value');
          if (new TextEncoder().encode(data).byteLength > SOCKET_FRAME_BYTES) throw new Error('socket frame exceeds its limit');
          socket.send(data);
        },
        onMessage(listener) {
          if (closed) throw new Error('loopback connection closed');
          listeners.add(listener);
          const buffered = queued.splice(0); queuedBytes = 0;
          for (const entry of buffered) listener(entry.message);
          return () => { listeners.delete(listener); };
        },
        onClose(listener: (error: Error) => void) {
          if (closed) { listener(closeError); return () => {}; }
          closeListeners.add(listener);
          return () => { closeListeners.delete(listener); };
        },
        close: () => stop(),
      });
    }
    socket.addEventListener('open', open);
    socket.addEventListener('message', message);
    socket.addEventListener('error', error);
    socket.addEventListener('close', ended);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}
