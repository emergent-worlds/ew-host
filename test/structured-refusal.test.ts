import { describe, expect, it } from 'vitest';
import { HostBridge, HostMessage, Manifest, type HostHandlers, type Transport } from '../src/index.js';
import { connectCore } from '../src/loader.js';
import { HostRefusal, HostRefusalError } from '../src/refusal.js';

const asks = Manifest.parse({ name: 'Kestrel Yards', kind: 'reality', version: '1.0.0', owner: '@mercerpress', entry: { web: 'index.html' }, asks: { saves: true, models: { jobs: ['narration'] } } }).asks!;
async function setup(handlers: HostHandlers = {}) {
  const listeners = [new Set<(value: unknown) => void>(), new Set<(value: unknown) => void>()];
  const sent: unknown[] = [];
  const side = (i: number): Transport => ({
    send: value => { const wire = JSON.parse(JSON.stringify(value)); sent.push(wire); queueMicrotask(() => listeners[1 - i]!.forEach(listener => listener(wire))); },
    onMessage: listener => (listeners[i]!.add(listener), () => { listeners[i]!.delete(listener); }), close: () => { listeners[i]!.clear(); },
  });
  const bridge = new HostBridge(side(0), asks, { ready: () => bridge.send({ type: 'grant', asks, session: 'fixture', headless: true, files: [], version: { id: 'v1', seq: 1 }, display: { theme: 'light', textSize: 'default', contrast: 'default', motion: 'full', language: 'en' } }), ...handlers }, 1000, 'core');
  const host = await connectCore(side(1));
  return { host, bridge, sent, close: () => { host.close(); bridge.close(); } };
}
const call = { kind: 'text' as const, messages: [{ role: 'user' as const, content: 'a synthetic fixture' }] };
async function rejected(promise: Promise<unknown>): Promise<Error & { code?: string; detail?: Record<string, unknown> }> {
  try { await promise; } catch (error) { if (error instanceof Error) return error; throw new Error('the fixture rejected without an Error'); }
  throw new Error('the fixture did not reject');
}

describe('structured privileged host refusals', () => {
  it('preserves a model route code and explicit needed detail over the actual bridge and loader', async () => {
    const data = { remaining: 0, stopped: [{ job: 'narration', kind: 'language', needed: true }], needed: true };
    const f = await setup({ modelCall: async () => { throw Object.assign(new Error('compute is below the floor'), { code: 'under_floor', detail: data, internal: 'synthetic-private-extra' }); } });
    try {
      const error = await rejected(f.host.model('narration', call).reply);
      expect(error).toBeInstanceOf(HostRefusal); expect(error).toBeInstanceOf(HostRefusalError); expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('compute is below the floor'); expect(error.code).toBe('under_floor'); expect(error.detail).toEqual(data);
      expect(JSON.stringify(f.sent)).not.toContain('synthetic-private-extra');
    } finally { f.close(); }
  });
  it.each([false, undefined, 'false'])('does not derive optionality when needed is %s', async needed => {
    const detail = needed === undefined ? { stopped: [] } : { stopped: [], needed };
    const f = await setup({ modelCall: async () => { throw new HostRefusal('compute_used_up', 'compute ended', detail); } });
    try { const error = await rejected(f.host.model('narration', call).reply); expect(error.code).toBe('compute_used_up'); expect(error.detail?.needed).toBe(needed); }
    finally { f.close(); }
  });
  it('keeps legacy text-only failures and never infers a code from their wording', async () => {
    const f = await setup({ modelCall: async () => { throw new Error('under_floor is only text here'); } });
    try {
      const error = await rejected(f.host.model('narration', call).reply);
      expect(error).toBeInstanceOf(Error); expect(error).not.toBeInstanceOf(HostRefusal); expect(error.message).toBe('under_floor is only text here'); expect(error.code).toBeUndefined(); expect(error.detail).toBeUndefined();
    } finally { f.close(); }
  });
  it('preserves typed folder-handler refusals on a host request as well', async () => {
    const f = await setup();
    f.host.handle('state.read', () => { throw new HostRefusal('state_unavailable', 'the state cannot be read', { retry: true }); });
    try { const error = await rejected(f.bridge.request({ type: 'state.read', path: '' })); expect(error).toBeInstanceOf(HostRefusal); expect(error.code).toBe('state_unavailable'); expect(error.detail).toEqual({ retry: true }); }
    finally { f.close(); }
  });
  it('preserves save refusals and discards non-JSON detail without losing a stable code', async () => {
    const circular: Record<string, unknown> = {}; circular.self = circular;
    const f = await setup({ save: async () => { throw Object.assign(new Error('save refused'), { code: 'save_refused', detail: circular }); } });
    try {
      const error = await rejected(f.host.save('interval', []));
      expect(error).toBeInstanceOf(HostRefusal); expect(error.code).toBe('save_refused'); expect(error.detail).toBeUndefined();
    } finally { f.close(); }
  });
  it('accepts old reply envelopes and validates detail as a JSON object', () => {
    const old = { ew: 1, type: 'reply', reply_to: 1, ok: false, error: 'refused' };
    expect(HostMessage.safeParse(old).success).toBe(true);
    expect(HostMessage.safeParse({ ...old, code: 'under_floor', detail: { needed: false } }).success).toBe(true);
    for (const detail of [[], null, { needed: undefined }, { value: Infinity }, { callback: () => {} }]) expect(HostMessage.safeParse({ ...old, detail }).success).toBe(false);
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(HostMessage.safeParse({ ...old, detail: circular }).success).toBe(false);
  });
  it('keeps cancellation separate from an interrupted model-policy refusal', async () => {
    let begin!: () => void; const begun = new Promise<void>(resolve => { begin = resolve; });
    const f = await setup({ modelCall: (_message, _part, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new HostRefusal('under_floor', 'budget refusal', { needed: false })), { once: true }); begin(); }) });
    try {
      const pending = f.host.model('narration', call); await begun; f.host.cancel(pending.id);
      const error = await rejected(pending.reply); expect(error.message).toBe('cancelled'); expect(error.code).toBeUndefined(); expect(error.detail).toBeUndefined();
    } finally { f.close(); }
  });
});
