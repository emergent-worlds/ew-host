import { describe, expect, it } from 'vitest';
import { RemoteClientFrame, RemoteServerFrame, parseRemoteClientFrame, parseRemoteServerFrame, encodeRemoteClientFrame, encodeRemoteServerFrame } from '../src/remote-schema.js';

describe('E8 direction-specific wire', () => {
  it('accepts every specified client channel and rejects server control in that direction', () => {
    const frames = [
      { v: 1, ch: 'ctl', type: 'join', token: 'synthetic-join' },
      { v: 1, ch: 'ctl', type: 'resume', credential: 'synthetic-resume', lastSeq: 0 },
      { v: 1, ch: 'ctl', type: 'ack', seq: 3 }, { v: 1, ch: 'ctl', type: 'leave' },
      { v: 1, ch: 'port', requestId: 'stable-id', body: { ew: 1, id: 1, call: 'np.read', args: null, from: 'claimed' } },
      { v: 1, ch: 'input', requestId: 'input-id', kind: 'text', data: 'hello' },
      { v: 1, ch: 'agent', requestId: 'ask-id', type: 'ask', text: 'why?' },
      { v: 1, ch: 'agent', requestId: 'decide-id', type: 'decide', decision: 'decision-id', choice: 'yes' },
    ];
    for (const frame of frames) expect(RemoteClientFrame.safeParse(frame).success).toBe(true);
    expect(RemoteClientFrame.safeParse({ v: 1, ch: 'ctl', type: 'ready', seq: 0 }).success).toBe(false);
    expect(RemoteServerFrame.safeParse(frames[0]).success).toBe(false);
  });
  it('accepts the server synchronization, notices, replies and public control vocabulary', () => {
    const frames = [
      { v: 1, ch: 'ctl', type: 'admitted', slotId: 'slot', sender: 'sender', epoch: 1, resume: 'synthetic-resume' },
      { v: 1, ch: 'ctl', type: 'snapshot', seq: 0, notices: [{ ew: 1, notice: 'np.view', data: {} }] },
      { v: 1, ch: 'ctl', type: 'sync', seq: 0, mode: 'snapshot' }, { v: 1, ch: 'ctl', type: 'ready', seq: 2 },
      { v: 1, ch: 'ctl', type: 'players', present: [{ sender: 'sender', handle: '@salt_and_ash', host: true }], max: 6 },
      { v: 1, ch: 'ctl', type: 'policy', terminal: 'everyone' }, { v: 1, ch: 'ctl', type: 'saved', at: '2026-10-15T00:00:00Z' },
      { v: 1, ch: 'ctl', type: 'ending', reason: 'the host left' }, { v: 1, ch: 'ctl', type: 'error', code: 'closed', message: 'closed' },
      { v: 1, ch: 'port', seq: 1, body: { ew: 1, notice: 'np.view', data: {} } },
      { v: 1, ch: 'port', requestId: 'stable-id', body: { ew: 1, reply_to: 7, ok: true, result: null } },
      { v: 1, ch: 'input', requestId: 'input-id', ok: false, error: 'refused' },
      { v: 1, ch: 'agent', requestId: 'ask-id', type: 'part', text: 'a part' },
      { v: 1, ch: 'agent', requestId: 'ask-id', type: 'result', ok: true, text: 'done', decision: {} },
    ];
    for (const frame of frames) expect(RemoteServerFrame.safeParse(frame).success).toBe(true);
    expect(RemoteServerFrame.safeParse({ v: 1, ch: 'port', requestId: 'stable-id', body: { ew: 1, id: 1, call: 'load' } }).success).toBe(false);
  });
  it('rejects unsafe sequence/port ids, unknown authority fields and ambiguous channels', () => {
    expect(RemoteClientFrame.safeParse({ v: 1, ch: 'input', requestId: 'i', kind: 'text' }).success).toBe(false);
    expect(RemoteClientFrame.safeParse({ v: 1, ch: 'input', requestId: 'i', kind: 'text', data: null, payer: 'other' }).success).toBe(false);
    expect(RemoteClientFrame.safeParse({ v: 1, ch: 'port', requestId: 'p', body: { ew: 1, id: Number.MAX_SAFE_INTEGER + 1, call: 'read' } }).success).toBe(false);
    expect(RemoteServerFrame.safeParse({ v: 1, ch: 'port', seq: 0, body: { ew: 1, notice: 'tick' } }).success).toBe(false);
    expect(RemoteServerFrame.safeParse({ v: 1, ch: 'ctl', type: 'sync', seq: Number.MAX_SAFE_INTEGER + 1, mode: 'replay' }).success).toBe(false);
    expect(RemoteServerFrame.safeParse({ v: 1, ch: 'ctl', type: 'players', present: [{ sender: 's', handle: '@salt_and_ash', host: false, accountId: 'private' }], max: 1 }).success).toBe(false);
    expect(RemoteServerFrame.safeParse({ v: 1, ch: 'port', seq: 1, requestId: 'mixed', body: { ew: 1, notice: 'tick' } }).success).toBe(false);
  });
  it('enforces the UTF-8 frame bound and reports fixed errors without credential text', () => {
    const raw = JSON.stringify({ v: 1, ch: 'ctl', type: 'join', token: 'synthetic-not-a-real-secret', extra: true });
    expect(() => parseRemoteClientFrame(raw)).toThrow('invalid remote frame');
    expect(() => parseRemoteClientFrame(raw)).not.toThrow('synthetic-not-a-real-secret');
    expect(() => encodeRemoteClientFrame({ v: 1, ch: 'ctl', type: 'join', token: 'é'.repeat(2 * 1024 * 1024) })).toThrow('oversized');
    expect(() => parseRemoteServerFrame(new Uint8Array())).toThrow('JSON text');
    const frame = { v: 1, ch: 'ctl', type: 'ack', seq: 0 } as const;
    expect(parseRemoteClientFrame(encodeRemoteClientFrame(frame))).toEqual(frame);
  });
  it('rejects non-JSON payloads rather than silently normalizing their request identity', () => {
    for (const data of [NaN, Infinity, new Date(), () => {}, [undefined], 1n]) expect(() => encodeRemoteClientFrame({ v: 1, ch: 'input', requestId: 'i', kind: 'text', data })).toThrow('invalid');
    expect(() => encodeRemoteServerFrame({ v: 1, ch: 'port', requestId: 'r', body: { ew: 1, reply_to: 1, ok: true, result: NaN } })).toThrow('invalid');
  });
});
