import { describe, expect, it, vi } from 'vitest';
import { HostBridge, HostMessage, Manifest, type Transport } from '../src/index.js';
import { connectCore, connectPage } from '../src/loader.js';

function pair(): [Transport, Transport] {
  const listeners = [new Set<(m: unknown) => void>(), new Set<(m: unknown) => void>()];
  const side = (i: number): Transport => ({
    send: m => queueMicrotask(() => listeners[1 - i]!.forEach(fn => fn(structuredClone(m)))),
    onMessage: fn => (listeners[i]!.add(fn), () => { listeners[i]!.delete(fn); }),
    close: () => listeners[i]!.clear(),
  });
  return [side(0), side(1)];
}
const asks = Manifest.parse({ name: 'Salt Harbor', kind: 'reality', version: '1.0.0', owner: '@salt_and_ash', entry: { web: 'index.html' }, asks: { surface: 'full', saves: true, agent: 'change', models: { jobs: ['narration'] } } }).asks!;
const grant = { type: 'grant' as const, asks, session: 'one', headless: false, journeys: false, version: { id: 'v', seq: 1 }, display: { theme: 'light' as const, textSize: 'default' as const, contrast: 'default' as const, motion: 'full' as const, language: 'en' } };

describe('split host endpoints (Wave 3 E7)', () => {
  it('keeps equal request ids on their originating endpoints and excludes core methods from the page', async () => {
    const [ch, cf] = pair(); const [ph, pf] = pair();
    const coreBridge = new HostBridge(ch, asks, { ready: () => { coreBridge.send(grant); }, save: async () => 'core-save' }, 100, 'core');
    const pageBridge = new HostBridge(ph, asks, { ready: () => { pageBridge.send(grant); }, prefsSet: async () => 'page-prefs' }, 100, 'page');
    const [core, page] = await Promise.all([connectCore(cf), connectPage(pf)]);
    expect('model' in page).toBe(false); expect('save' in page).toBe(false); expect('pick' in core).toBe(false);
    expect(await Promise.all([core.save('own', []), page.prefs({ theme: 'light' })])).toEqual(['core-save', 'page-prefs']);
    coreBridge.close(); pageBridge.close();
  });
  it('carries authoritative recap metadata and opens away settings on the page only', async () => {
    const [ph, pf] = pair(); const opened = vi.fn();
    const bridge = new HostBridge(ph, asks, { ready: () => bridge.send({ ...grant, away: { pace: 'day', computeShare: null } }), appOpen: opened }, 100, 'page');
    const page = await connectPage(pf);
    expect(page.grant.away).toEqual({ pace: 'day', computeShare: null });
    page.open('away');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(opened).toHaveBeenCalledWith('away', undefined);
    for (const value of [-1, 101, Number.NaN]) expect(HostMessage.safeParse({ ew: 1, ...grant, away: { pace: 'day', computeShare: value } }).success).toBe(false);
    expect(HostMessage.parse({ ew: 1, ...grant, away: { pace: 'hour', computeShare: 0 } })).toHaveProperty('away.computeShare', 0);
    bridge.close();
  });
  it('rejects a legacy combined grant on a new page connection', async () => {
    const [host, folder] = pair();
    host.onMessage(() => host.send({ ew: 1, ...grant }));
    await expect(connectPage(folder)).rejects.toThrow('expected page grant');
  });
  it('delivers quit only to the core', async () => {
    const [ch, cf] = pair(); const [ph] = pair();
    const cb = new HostBridge(ch, asks, { ready: () => { cb.send(grant); } }, 100, 'core');
    const pb = new HostBridge(ph, asks, {}, 100, 'page');
    const core = await connectCore(cf); const seen: string[] = [];
    core.handle('quit', m => seen.push(m.reason));
    await expect(cb.request({ type: 'quit', reason: 'leaving' })).resolves.toBe(1);
    await expect(pb.request({ type: 'quit', reason: 'leaving' })).rejects.toThrow('not granted');
    await new Promise(resolve => setTimeout(resolve, 0)); expect(seen).toEqual(['leaving']);
    cb.close(); pb.close();
  });
  it('refuses raw privileged requests from a page even when the manifest asks for them', async () => {
    const [ph, pf] = pair(); const save = vi.fn(); const model = vi.fn(); const agent = vi.fn();
    const bridge = new HostBridge(ph, asks, { save, modelCall: model, agentAsk: agent }, 100, 'page');
    const replies: unknown[] = []; pf.onMessage(m => replies.push(m));
    pf.send({ ew: 1, type: 'save', id: 1, reason: 'own', files: [] });
    pf.send({ ew: 1, type: 'model.call', id: 2, job: 'narration', request: { messages: [{ role: 'user', content: 'hello' }] } });
    pf.send({ ew: 1, type: 'agent.ask', id: 3, text: 'change the fund' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(replies).toHaveLength(3); expect(replies.every(r => (r as { ok: boolean }).ok === false)).toBe(true);
    expect(save).not.toHaveBeenCalled(); expect(model).not.toHaveBeenCalled(); expect(agent).not.toHaveBeenCalled(); bridge.close();
  });
  it('sends display to both but corner and layout only to the page', async () => {
    const [ch, cf] = pair(); const [ph, pf] = pair();
    const cb = new HostBridge(ch, asks, { ready: () => { cb.send(grant); } }, 100, 'core');
    const pb = new HostBridge(ph, asks, { ready: () => { pb.send(grant); } }, 100, 'page');
    const [core, page] = await Promise.all([connectCore(cf), connectPage(pf)]);
    const seen: string[] = []; core.on('display', () => seen.push('core')); page.on('display', () => seen.push('page'));
    page.handle('layout.reset', () => 'reset');
    expect(cb.send({ type: 'corner', corner: 'left' })).toBe(false);
    expect(pb.send({ type: 'corner', corner: 'left' })).toBe(true);
    cb.send({ type: 'display', display: grant.display }); pb.send({ type: 'display', display: grant.display });
    await expect(cb.request({ type: 'layout.reset' })).rejects.toThrow('not granted');
    await expect(pb.request({ type: 'layout.reset' })).resolves.toBe('reset');
    expect(seen).toEqual(['core', 'page']); cb.close(); pb.close();
  });
});
