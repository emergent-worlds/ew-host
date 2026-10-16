import { expect, it, vi } from 'vitest';
import { callPort, servePort } from '../src/port.js';
import type { Transport } from '../src/bridge.js';
it('passes only the envelope sender to core handlers', async () => {
  let receive!: (m: unknown) => void; const send = vi.fn(); const handler = vi.fn(async () => 'done');
  const server = servePort({ send, close() {}, onMessage(fn) { receive = fn; return () => {}; } }, { input: handler });
  receive({ ew: 1, id: 1, call: 'input', args: { sender: 'forged' }, from: 'authenticated' });
  await Promise.resolve();
  expect(handler).toHaveBeenCalledWith({ sender: 'forged' }, 'authenticated');
  expect(send).toHaveBeenCalledWith({ ew: 1, reply_to: 1, ok: true, result: 'done' }); server.close();
});
it('rejects pending and future calls promptly when the transport closes', async () => {
  let ended!: (e: Error) => void;
  const t: Transport = { send() {}, close: vi.fn(), onMessage: () => () => {}, onClose(fn) { ended = fn; return () => {}; } };
  const client = callPort(t); const pending = client.call('read');
  ended(new Error('connection ended'));
  await expect(pending).rejects.toThrow('connection ended');
  await expect(client.call('read')).rejects.toThrow('port closed');
  client.close(); expect(t.close).toHaveBeenCalledTimes(1);
});
it('clears the waiter when a transport refuses a send', async () => {
  vi.useFakeTimers();
  const client = callPort({ send() { throw new Error('send refused'); }, close() {}, onMessage: () => () => {} });
  await expect(client.call('read')).rejects.toThrow('send refused');
  expect(vi.getTimerCount()).toBe(0); client.close(); vi.useRealTimers();
});

it('does not reply after a server connection closes during a handler', async () => {
  let receive!: (m: unknown) => void; let finish!: () => void;
  const send = vi.fn(); const gate = new Promise<void>(resolve => { finish = resolve; });
  const server = servePort({ send, close() {}, onMessage(fn) { receive = fn; return () => {}; } }, { read: async () => { await gate; return 'done'; } });
  receive({ ew: 1, id: 1, call: 'read' }); server.close(); finish();
  await Promise.resolve(); await Promise.resolve(); expect(send).not.toHaveBeenCalled();
});
