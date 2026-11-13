import { describe, expect, it, vi } from 'vitest';
import { HostBridge, Manifest, type Transport } from '../src/index.js';
import { connectCore, connectPage } from '../src/loader.js';

function pair(): [Transport, Transport] {
  const messages = [new Set<(m: unknown) => void>(), new Set<(m: unknown) => void>()];
  const closes = [new Set<(e: Error) => void>(), new Set<(e: Error) => void>()];
  let closed = false;
  const side = (i: number): Transport => ({
    send: m => { if (closed) throw new Error('closed'); queueMicrotask(() => { if (!closed) messages[1 - i]!.forEach(fn => fn(structuredClone(m))); }); },
    onMessage: fn => (messages[i]!.add(fn), () => { messages[i]!.delete(fn); }),
    onClose: fn => (closes[i]!.add(fn), () => { closes[i]!.delete(fn); }),
    close: () => { if (closed) return; closed = true; for (const handlers of closes) for (const fn of [...handlers]) fn(new Error('fixture connection closed')); },
  });
  return [side(0), side(1)];
}
const asks = Manifest.parse({ name: 'Salt Harbor', kind: 'reality', version: '1.0.0', owner: '@salt_and_ash', entry: { web: 'index.html' }, asks: { surface: 'full', saves: true } }).asks!;
const grant = { type: 'grant' as const, asks, session: 'one', headless: false, journeys: false, version: { id: 'v', seq: 1 }, display: { theme: 'light' as const, textSize: 'default' as const, contrast: 'default' as const, motion: 'full' as const, language: 'en' } };

describe('split connection lifecycle', () => {
  it('correlates quit completion and failure on the core', async () => {
    const [h, f] = pair();
    const bridge = new HostBridge(h, asks, { ready: () => bridge.send(grant) }, 100, 'core');
    const core = await connectCore(f);
    core.handle('quit', async () => ({ saved: 'v2', exited: true }));
    await expect(bridge.request({ type: 'quit', reason: 'leaving' })).resolves.toEqual({ saved: 'v2', exited: true });
    core.handle('quit', () => { throw new Error('save refused'); });
    await expect(bridge.request({ type: 'quit', reason: 'leaving' })).rejects.toThrow('save refused');
    core.close();
  });

  it('rejects pending folder requests when the peer transport closes', async () => {
    const [h, f] = pair();
    const bridge = new HostBridge(h, asks, { ready: () => bridge.send(grant), prefsSet: () => new Promise(() => {}) }, 100, 'page');
    const page = await connectPage(f);
    const pending = page.prefs({});
    await Promise.resolve();
    const refused = expect(pending).rejects.toThrow('closed');
    bridge.close();
    await refused;
  });

  it('rejects both directions on local loader disposal and unregisters listeners', async () => {
    const [h, f] = pair();
    const bridge = new HostBridge(h, asks, { ready: () => bridge.send(grant), fileRead: () => new Promise(() => {}) }, 100, 'core');
    const core = await connectCore(f);
    core.handle('state.read', () => new Promise(() => {}));
    const reading = core.read('notes.txt');
    const asking = bridge.request({ type: 'state.read', path: '' });
    const rejected = [expect(reading).rejects.toThrow('closed'), expect(asking).rejects.toThrow('closed')];
    core.close();
    await Promise.all(rejected);
    await expect(core.read('notes.txt')).rejects.toThrow('closed');
    expect(bridge.send({ type: 'display', display: grant.display })).toBe(false);
  });

  it('cleans up the transport and listener after a missing or mismatched grant', async () => {
    for (const mismatch of [false, true]) {
      let listener: ((m: unknown) => void) | undefined;
      const unlisten = vi.fn(); const close = vi.fn();
      const transport: Transport = { send: () => { if (mismatch) listener?.({ ew: 1, ...grant, endpoint: 'page' }); }, onMessage: fn => { listener = fn; return unlisten; }, close };
      await expect(connectCore(transport, 5)).rejects.toThrow(mismatch ? 'expected core grant' : 'no grant');
      expect(unlisten).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
    }
  });

  it('rejects a requested save that is still committing when the transport closes', async () => {
    const [h, f] = pair();
    let started!: () => void;
    const begun = new Promise<void>(r => { started = r; });
    const bridge = new HostBridge(h, asks, { ready: () => bridge.send(grant), save: () => { started(); return new Promise(() => {}); } }, 1000, 'core');
    const core = await connectCore(f);
    let saving!: Promise<unknown>;
    core.on('save.request', () => { saving = core.save('leaving', []); void saving.catch(() => {}); });
    const requested = bridge.requestSave('leaving');
    await begun;
    const refused = expect(requested).rejects.toThrow('closed');
    core.close();
    await refused;
    await expect(saving).rejects.toThrow('closed');
  });
});
