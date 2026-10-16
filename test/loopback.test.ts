import { describe, expect, it } from 'vitest';
import { loopbackTransport, SOCKET_FRAME_BYTES, type SocketLike } from '../src/loopback.js';
class Socket implements SocketLike {
  readyState = 0; sent: string[] = []; listeners = new Map<string, Set<(e: any) => void>>();
  addEventListener(t: string, fn: (e: any) => void) { const set = this.listeners.get(t) ?? new Set(); set.add(fn); this.listeners.set(t, set); }
  removeEventListener(t: string, fn: (e: any) => void) { this.listeners.get(t)?.delete(fn); }
  emit(t: string, e: any = {}) { for (const fn of this.listeners.get(t) ?? []) fn(e); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.emit('open'); }
}
describe('installed loopback transport', () => {
  it('sends the token first and retains an immediate grant until the loader listens', async () => {
    const socket = new Socket(); const pending = loopbackTransport('ws://127.0.0.1:12345/', 'test-token', { socket: () => socket });
    socket.open(); socket.emit('message', { data: '{"type":"grant"}' });
    const transport = await pending; const seen: unknown[] = []; transport.onMessage(m => seen.push(m));
    expect(socket.sent).toEqual(['{"token":"test-token"}']); expect(seen).toEqual([{ type: 'grant' }]);
    transport.send({ type: 'ready' }); expect(socket.sent[1]).toBe('{"type":"ready"}'); transport.close();
    expect(socket.readyState).toBe(3);
  });
  it.each(['wss://127.0.0.1:12345/', 'ws://example.com:12345/', 'ws://localhost:12345/', 'ws://127.0.0.1:12345/?token=secret', 'ws://person:secret@127.0.0.1:12345/'])('refuses a non-launch endpoint %s', async url => {
    await expect(loopbackTransport(url, 'test-token')).rejects.toThrow('loopback');
  });
  it('closes malformed or oversized incoming frames and refuses oversized outgoing frames', async () => {
    const socket = new Socket(); const pending = loopbackTransport('ws://127.0.0.1:12345/', 'test-token', { socket: () => socket }); socket.open();
    const transport = await pending;
    expect(() => transport.send('x'.repeat(SOCKET_FRAME_BYTES))).toThrow('limit');
    socket.emit('message', { data: 'not-json' }); expect(socket.readyState).toBe(3);
    expect(() => transport.send({})).toThrow('closed');
  });
  it.each(['not-json', JSON.stringify('x'.repeat(SOCKET_FRAME_BYTES))])('notifies lifecycle listeners when an incoming frame is refused', async data => {
    const socket = new Socket(); const pending = loopbackTransport('ws://127.0.0.1:12345/', 'test-token', { socket: () => socket }); socket.open();
    const transport = await pending; const reasons: string[] = [];
    transport.onClose!(error => reasons.push(error.message));
    socket.emit('message', { data });
    expect(reasons).toHaveLength(1); expect(socket.readyState).toBe(3); transport.close(); expect(reasons).toHaveLength(1);
  });
  it('reports a peer disconnect after connection resolves', async () => {
    const socket = new Socket(); const pending = loopbackTransport('ws://127.0.0.1:12345/', 'test-token', { socket: () => socket }); socket.open();
    const transport = await pending; let closed = false; transport.onClose!(() => { closed = true; });
    socket.emit('close'); expect(closed).toBe(true);
  });
  it('cancels and removes listeners before an opening connection can authenticate', async () => {
    const socket = new Socket(); const controller = new AbortController();
    const pending = loopbackTransport('ws://127.0.0.1:12345/', 'test-token', { socket: () => socket, signal: controller.signal });
    controller.abort(); await expect(pending).rejects.toThrow('cancelled'); socket.open(); expect(socket.sent).toEqual([]);
  });
});
