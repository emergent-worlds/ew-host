import { afterEach, describe, expect, it, vi } from 'vitest';
import { remotePort, type RemotePort, type RemotePortOptions } from '../src/remote.js';
import { encodeRemoteServerFrame, type RemoteServerFrame } from '../src/remote-schema.js';
import type { SocketLike } from '../src/loopback.js';

class Socket implements SocketLike {
  readyState = 0;
  sent: any[] = [];
  handlers = new Map<string, Set<(event: any) => void>>();
  addEventListener(name: string, handler: (event: any) => void) { const set = this.handlers.get(name) ?? new Set(); set.add(handler); this.handlers.set(name, set); }
  removeEventListener(name: string, handler: (event: any) => void) { this.handlers.get(name)?.delete(handler); }
  emit(name: string, event: any = {}) { for (const handler of [...this.handlers.get(name) ?? []]) handler(event); }
  send(text: string) { if (this.readyState !== 1) throw new Error('synthetic closed socket'); this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.emit('close'); }
  open() { this.readyState = 1; this.emit('open'); }
  frame(frame: RemoteServerFrame) { this.emit('message', { data: encodeRemoteServerFrame(frame) }); }
}
const clients: RemotePort[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.close(); vi.useRealTimers(); });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const admission = (resume = 'synthetic-resume-1', epoch = 1): RemoteServerFrame => ({ v: 1, ch: 'ctl', type: 'admitted', slotId: 'slot-1', sender: 'sender-1', epoch, resume });
function fixture(options: Partial<RemotePortOptions> = {}) {
  const sockets: Socket[] = []; const install = vi.fn(async () => {});
  const client = remotePort('wss://fixture.invalid/session', { token: 'synthetic-join', installSnapshot: install, socket: () => { const socket = new Socket(); sockets.push(socket); return socket; }, ...options });
  clients.push(client);
  return { client, sockets, install, get socket() { return sockets.at(-1)!; } };
}
async function start(f: ReturnType<typeof fixture>, seq = 0) {
  f.socket.open(); f.socket.frame(admission());
  f.socket.frame({ v: 1, ch: 'ctl', type: 'snapshot', seq, notices: [{ ew: 1, notice: 'np.view', data: { value: seq } }] });
  f.socket.frame({ v: 1, ch: 'ctl', type: 'sync', seq, mode: 'snapshot' });
  await flush(); f.socket.frame({ v: 1, ch: 'ctl', type: 'ready', seq }); await f.client.ready;
}
async function resume(f: ReturnType<typeof fixture>, seq: number, snapshot = false, credential = 'synthetic-resume-2') {
  const ready = f.client.reconnect(); f.socket.open(); f.socket.frame(admission(credential));
  if (snapshot) f.socket.frame({ v: 1, ch: 'ctl', type: 'snapshot', seq, notices: [] });
  f.socket.frame({ v: 1, ch: 'ctl', type: 'sync', seq, mode: snapshot ? 'snapshot' : 'replay' });
  await flush(); f.socket.frame({ v: 1, ch: 'ctl', type: 'ready', seq }); await ready;
}

describe('remote page synchronization', () => {
  it('waits for cross-frame replay application before releasing readiness', async () => {
    let apply!: () => void;
    const f = fixture({ applyNotice: () => new Promise<void>(resolve => { apply = resolve; }) });
    await start(f);
    f.socket.close(); const ready = f.client.reconnect(); f.socket.open(); f.socket.frame(admission('next-credential'));
    f.socket.frame({ v: 1, ch: 'port', seq: 1, body: { ew: 1, notice: 'view', data: 'personal' } });
    f.socket.frame({ v: 1, ch: 'ctl', type: 'sync', seq: 1, mode: 'replay' });
    f.socket.frame({ v: 1, ch: 'ctl', type: 'ready', seq: 1 });
    await flush(); expect(f.client.lastSeq).toBe(0); expect(f.client.state).toBe('syncing');
    expect(f.socket.sent.some(frame => frame.type === 'ack')).toBe(false);
    apply(); await ready; expect(f.client.lastSeq).toBe(1); expect(f.client.state).toBe('ready');
  });
  it('awaits the snapshot installer, exact ack and latest ready boundary before calls or input', async () => {
    let release!: () => void;
    const install = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const controls = vi.fn(); const f = fixture({ installSnapshot: install, onControl: controls });
    const notice = vi.fn(); f.client.on('np.view', notice);
    f.socket.open(); expect(f.socket.sent[0]).toEqual({ v: 1, ch: 'ctl', type: 'join', token: 'synthetic-join' });
    f.socket.frame(admission());
    f.socket.frame({ v: 1, ch: 'ctl', type: 'snapshot', seq: 3, notices: [{ ew: 1, notice: 'np.view', data: 'snapshot' }] });
    f.socket.frame({ v: 1, ch: 'ctl', type: 'sync', seq: 3, mode: 'snapshot' });
    await flush(); expect(f.socket.sent.filter(frame => frame.type === 'ack')).toEqual([]);
    await expect(f.client.call('np.read')).rejects.toThrow('not synchronized');
    await expect(f.client.input('text', 'hello')).rejects.toThrow('not synchronized');
    release(); await flush(); expect(f.socket.sent.at(-1)).toEqual({ v: 1, ch: 'ctl', type: 'ack', seq: 3 });
    f.socket.frame({ v: 1, ch: 'port', seq: 4, body: { ew: 1, notice: 'np.view', data: 'tail' } });
    f.socket.frame({ v: 1, ch: 'ctl', type: 'ready', seq: 4 }); await f.client.ready;
    expect(f.client.state).toBe('ready'); expect(f.client.lastSeq).toBe(4); expect(notice).toHaveBeenCalledExactlyOnceWith('tail');
    expect(f.socket.sent.at(-1)).toEqual({ v: 1, ch: 'ctl', type: 'ack', seq: 4 });
    expect(controls).not.toHaveBeenCalled(); expect(f.client.admission).toEqual({ slotId: 'slot-1', sender: 'sender-1', epoch: 1 });
  });
  it('ignores duplicate notices and stops calls on a gap until explicit replacement synchronization', async () => {
    const f = fixture(); await start(f); const notice = vi.fn(); f.client.on('tick', notice);
    f.socket.frame({ v: 1, ch: 'port', seq: 1, body: { ew: 1, notice: 'tick', data: 1 } });
    f.socket.frame({ v: 1, ch: 'port', seq: 1, body: { ew: 1, notice: 'tick', data: 1 } }); await flush();
    expect(notice).toHaveBeenCalledTimes(1);
    f.socket.frame({ v: 1, ch: 'port', seq: 3, body: { ew: 1, notice: 'tick', data: 3 } }); await flush();
    expect(f.client.state).toBe('disconnected'); expect(f.sockets).toHaveLength(1); expect(f.client.lastSeq).toBe(1);
    await expect(f.client.call('np.read')).rejects.toThrow('not synchronized');
    await resume(f, 5, true); expect(f.client.lastSeq).toBe(5); expect(f.install).toHaveBeenCalledTimes(2);
  });
  it.each(['premature-ready', 'wrong-sync', 'initial-replay', 'wrong-ready'] as const)('refuses %s without acknowledging partial state', async kind => {
    const f = fixture(); f.socket.open(); f.socket.frame(admission());
    if (kind !== 'initial-replay') f.socket.frame({ v: 1, ch: 'ctl', type: 'snapshot', seq: 0, notices: [] });
    if (kind === 'premature-ready') f.socket.frame({ v: 1, ch: 'ctl', type: 'ready', seq: 0 });
    else f.socket.frame({ v: 1, ch: 'ctl', type: 'sync', seq: kind === 'wrong-sync' ? 1 : 0, mode: kind === 'initial-replay' ? 'replay' : 'snapshot' });
    await flush();
    if (kind === 'wrong-ready') { f.socket.frame({ v: 1, ch: 'port', seq: 1, body: { ew: 1, notice: 'tick' } }); f.socket.frame({ v: 1, ch: 'ctl', type: 'ready', seq: 0 }); await flush(); }
    expect(f.client.state).toBe('closed'); await expect(f.client.ready).rejects.toThrow('synchronization');
    if (kind !== 'wrong-ready') expect(f.socket.sent.filter(frame => frame.type === 'ack')).toEqual([]);
  });
  it('refuses a failed snapshot installation and aborts an old installer before a newer attempt is installed', async () => {
    const failed = fixture({ installSnapshot: async () => { throw new Error('synthetic page error'); } });
    failed.socket.open(); failed.socket.frame(admission()); failed.socket.frame({ v: 1, ch: 'ctl', type: 'snapshot', seq: 0, notices: [] }); await flush();
    expect(failed.client.state).toBe('closed'); expect(failed.socket.sent.filter(frame => frame.type === 'ack')).toEqual([]);
    let release!: () => void; let firstSignal!: AbortSignal; let n = 0; let page = 0;
    const f = fixture({ installSnapshot: async (_notices, seq, signal) => { if (++n === 1) { firstSignal = signal; await new Promise<void>(resolve => { release = resolve; }); } if (!signal.aborted) page = seq; } });
    f.socket.open(); f.socket.frame(admission()); f.socket.frame({ v: 1, ch: 'ctl', type: 'snapshot', seq: 1, notices: [] }); await flush();
    const old = f.socket; old.close(); expect(firstSignal.aborted).toBe(true);
    const ready = f.client.reconnect(); f.socket.open(); f.socket.frame(admission('synthetic-resume-2'));
    f.socket.frame({ v: 1, ch: 'ctl', type: 'snapshot', seq: 2, notices: [] }); f.socket.frame({ v: 1, ch: 'ctl', type: 'sync', seq: 2, mode: 'snapshot' });
    await flush(); expect(n).toBe(2);
    f.socket.frame({ v: 1, ch: 'ctl', type: 'ready', seq: 2 }); await ready; expect(f.client.lastSeq).toBe(2); expect(page).toBe(2);
    release(); await flush(); expect(page).toBe(2); expect(f.client.lastSeq).toBe(2);
  });
});

describe('remote operation identity and ownership', () => {
  it('retains port/input/agent requests across socket replacement and rotates only the resume credential', async () => {
    const f = fixture(); await start(f); const old = f.socket; const part = vi.fn();
    const args = { value: 1 };
    const call = f.client.call('np.read', args, 'call-id'); const input = f.client.input('text', 'hello', 'input-id'); const agent = f.client.ask('why?', { requestId: 'agent-id', part });
    args.value = 99; const original = old.sent.find(frame => frame.requestId === 'call-id');
    old.close(); const synchronized = f.client.reconnect(); f.socket.open();
    expect(f.socket.sent[0]).toEqual({ v: 1, ch: 'ctl', type: 'resume', credential: 'synthetic-resume-1', lastSeq: 0 });
    f.socket.frame(admission('synthetic-resume-2')); f.socket.frame({ v: 1, ch: 'ctl', type: 'sync', seq: 0, mode: 'replay' }); await flush();
    expect(f.socket.sent.some(frame => frame.requestId)).toBe(false);
    f.socket.frame({ v: 1, ch: 'ctl', type: 'ready', seq: 0 }); await synchronized;
    expect(f.socket.sent.find(frame => frame.requestId === 'call-id')).toEqual(original);
    f.socket.frame({ v: 1, ch: 'port', requestId: 'call-id', body: { ew: 1, reply_to: original.body.id, ok: true, result: 'read' } });
    f.socket.frame({ v: 1, ch: 'input', requestId: 'input-id', ok: true });
    f.socket.frame({ v: 1, ch: 'agent', requestId: 'agent-id', type: 'part', text: 'partial' });
    f.socket.frame({ v: 1, ch: 'agent', requestId: 'agent-id', type: 'result', ok: true, text: 'done' });
    await expect(call).resolves.toBe('read'); await expect(input).resolves.toBeUndefined(); await expect(agent).resolves.toMatchObject({ text: 'done' }); expect(part).toHaveBeenCalledExactlyOnceWith('partial');
    await resume(f, 0, false, 'synthetic-resume-3'); expect(f.socket.sent[0].credential).toBe('synthetic-resume-2');
  });
  it('coalesces a pending identity while refusing a changed operation and a mismatched numeric reply', async () => {
    const f = fixture(); await start(f);
    const one = f.client.call('np.read', { a: 1, b: 2 }, 'same');
    const two = f.client.call('np.read', { b: 2, a: 1 }, 'same'); expect(two).toBe(one);
    await expect(f.client.call('np.read', { a: 2 }, 'same')).rejects.toThrow('reused');
    expect(f.socket.sent.filter(frame => frame.requestId === 'same')).toHaveLength(1);
    f.socket.frame({ v: 1, ch: 'port', requestId: 'same', body: { ew: 1, reply_to: 100, ok: true } });
    await expect(one).rejects.toThrow('synchronization'); expect(f.client.state).toBe('closed');
  });
  it('rejects pending operations on changed slot/epoch and never blindly resubmits them', async () => {
    const f = fixture(); await start(f); const pending = f.client.call('np.read', null, 'uncertain');
    const pendingCheck = expect(pending).rejects.toThrow('synchronization');
    f.socket.close(); const ready = f.client.reconnect(); f.socket.open(); f.socket.frame(admission('synthetic-new-holder', 2));
    await expect(ready).rejects.toThrow('synchronization'); await pendingCheck;
    expect(f.socket.sent.some(frame => frame.requestId === 'uncertain')).toBe(false);
  });
  it('survives the local port default timeout while disconnected, then resolves the retained request once', async () => {
    vi.useFakeTimers(); const f = fixture(); await start(f); const pending = f.client.call('np.read', null, 'retained');
    const frame = f.socket.sent.at(-1); f.socket.close(); await vi.advanceTimersByTimeAsync(31000);
    await resume(f, 0);
    f.socket.frame({ v: 1, ch: 'port', requestId: 'retained', body: { ew: 1, reply_to: frame.body.id, ok: true, result: 7 } }); await expect(pending).resolves.toBe(7);
  });
  it('dispatches public controls without exposing admission credentials and preserves default-denied server errors', async () => {
    const control = vi.fn(); const f = fixture({ onControl: control }); await start(f);
    f.socket.frame({ v: 1, ch: 'ctl', type: 'policy', terminal: 'host' }); f.socket.frame({ v: 1, ch: 'ctl', type: 'players', present: [], max: 6 }); await flush();
    expect(control).toHaveBeenCalledTimes(2); expect(JSON.stringify(control.mock.calls)).not.toContain('synthetic-resume');
    const denied = f.client.call('load', {}, 'denied'); const request = f.socket.sent.at(-1);
    f.socket.frame({ v: 1, ch: 'port', requestId: 'denied', body: { ew: 1, reply_to: request.body.id, ok: false, error: 'synthetic private raw text' } });
    await expect(denied).rejects.toThrow('refused'); await expect(denied).rejects.not.toThrow('private raw text');
  });
});

describe('remote connection lifecycle and bounds', () => {
  it('refreshes at 55 minutes and never extends the five-minute loss window by retrying', async () => {
    vi.useFakeTimers(); const f = fixture(); await start(f);
    await vi.advanceTimersByTimeAsync(55 * 60 * 1000); expect(f.sockets).toHaveLength(2); expect(f.client.state).toBe('connecting');
    f.socket.open(); expect(f.socket.sent[0].type).toBe('resume'); f.socket.close();
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    const ready = f.client.reconnect(); f.socket.open(); f.socket.close();
    await vi.advanceTimersByTimeAsync(60 * 1000); expect(f.client.state).toBe('closed'); await expect(ready).rejects.toThrow('expired');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('sends explicit leave during synchronization and removes callbacks and timers on closure', async () => {
    vi.useFakeTimers(); const f = fixture(); f.socket.open(); f.socket.frame(admission()); await flush();
    f.client.close(); expect(f.socket.sent.at(-1)).toEqual({ v: 1, ch: 'ctl', type: 'leave' });
    expect([...f.socket.handlers.values()].every(set => set.size === 0)).toBe(true); expect(vi.getTimerCount()).toBe(0);
    await expect(f.client.ready).rejects.toThrow('closed');
  });
  it('refuses malformed direction, binary and oversized frames without echoing raw values', async () => {
    for (const data of [JSON.stringify({ v: 1, ch: 'ctl', type: 'join', token: 'synthetic-raw-value' }), new Uint8Array(), 'x'.repeat(4 * 1024 * 1024 + 1)]) {
      const f = fixture(); f.socket.open(); f.socket.emit('message', { data });
      await expect(f.client.ready).rejects.toThrow('invalid'); expect(f.client.state).toBe('closed');
    }
  });
  it('requires a secure clean default endpoint or an explicit native direct-socket adapter', () => {
    const installSnapshot = async () => {};
    for (const url of ['ws://remote.invalid/', 'wss://user:pass@remote.invalid/', 'wss://remote.invalid/?token=synthetic', 'https://remote.invalid/']) expect(() => remotePort(url, { token: 'synthetic', installSnapshot })).toThrow('address');
    const f = remotePort('ws://remote.invalid/', { token: 'synthetic', installSnapshot, socket: () => new Socket() }); clients.push(f); f.close();
  });
  it('does not reopen twice when the caller reconnects from its disconnected-state callback', async () => {
    let client!: RemotePort;
    const f = fixture({ onState: state => { if (state === 'disconnected') void client.reconnect().catch(() => undefined); } }); client = f.client;
    await start(f); const ready = client.reconnect(); expect(f.sockets).toHaveLength(2);
    f.socket.open(); f.socket.frame(admission('synthetic-resume-2')); f.socket.frame({ v: 1, ch: 'ctl', type: 'sync', seq: 0, mode: 'replay' }); await flush();
    f.socket.frame({ v: 1, ch: 'ctl', type: 'ready', seq: 0 }); await ready;
  });
  it('retains the readiness waiter when a ready-state observer immediately reconnects', async () => {
    let client!: RemotePort; let once = true;
    const f = fixture({ onState: state => { if (state === 'ready' && once) { once = false; void client.reconnect(); } } }); client = f.client;
    const initial = client.ready; f.socket.open(); f.socket.frame(admission());
    f.socket.frame({ v: 1, ch: 'ctl', type: 'snapshot', seq: 0, notices: [] }); f.socket.frame({ v: 1, ch: 'ctl', type: 'sync', seq: 0, mode: 'snapshot' }); await flush();
    f.socket.frame({ v: 1, ch: 'ctl', type: 'ready', seq: 0 }); await flush(); expect(f.sockets).toHaveLength(2);
    f.socket.open(); f.socket.frame(admission('synthetic-resume-2')); f.socket.frame({ v: 1, ch: 'ctl', type: 'sync', seq: 0, mode: 'replay' }); await flush();
    f.socket.frame({ v: 1, ch: 'ctl', type: 'ready', seq: 0 }); await initial; expect(client.state).toBe('ready');
  });
  it('preserves pending operations when a retry send fails during readiness', async () => {
    const f = fixture(); await start(f); const pending = f.client.call('np.read', null, 'send-retry');
    const original = f.socket.sent.at(-1); f.socket.close();
    const ready = f.client.reconnect(); f.socket.open(); f.socket.frame(admission('synthetic-resume-2'));
    f.socket.frame({ v: 1, ch: 'ctl', type: 'sync', seq: 0, mode: 'replay' }); await flush();
    const send = f.socket.send.bind(f.socket); f.socket.send = text => { if (JSON.parse(text).ch === 'port') throw new Error('synthetic send failure'); send(text); };
    f.socket.frame({ v: 1, ch: 'ctl', type: 'ready', seq: 0 }); await flush(); expect(f.client.state).toBe('disconnected');
    await resume(f, 0, false, 'synthetic-resume-3'); await ready;
    f.socket.frame({ v: 1, ch: 'port', requestId: 'send-retry', body: { ew: 1, reply_to: original.body.id, ok: true, result: 8 } }); await expect(pending).resolves.toBe(8);
  });
  it('bounds unread replay notices while an asynchronous snapshot is pending', async () => {
    const f = fixture({ installSnapshot: async () => { await new Promise(() => {}); } }); f.socket.open(); f.socket.frame(admission());
    f.socket.frame({ v: 1, ch: 'ctl', type: 'snapshot', seq: 0, notices: [] }); await flush();
    for (let seq = 1; seq <= 1001; seq++) f.socket.frame({ v: 1, ch: 'port', seq, body: { ew: 1, notice: 'tick' } });
    expect(f.client.state).toBe('closed'); await expect(f.client.ready).rejects.toThrow('excessive');
  });
  it('accepts a full-sized valid snapshot followed by its synchronization control', async () => {
    const f = fixture(); f.socket.open(); f.socket.frame(admission());
    f.socket.frame({ v: 1, ch: 'ctl', type: 'snapshot', seq: 0, notices: [{ ew: 1, notice: 'np.view', data: 'x'.repeat(4 * 1024 * 1024 - 200) }] });
    f.socket.frame({ v: 1, ch: 'ctl', type: 'sync', seq: 0, mode: 'snapshot' }); await flush();
    f.socket.frame({ v: 1, ch: 'ctl', type: 'ready', seq: 0 }); await f.client.ready; expect(f.client.state).toBe('ready');
  });
});
