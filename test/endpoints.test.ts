import { describe, expect, it, vi } from 'vitest';
import { HostBridge, HostMessage, Manifest, type PersonTextCheckResult, type Transport } from '../src/index.js';
import { connect, connectCore, connectPage } from '../src/loader.js';

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

describe('private person-text checks', () => {
  const review: PersonTextCheckResult = { verdict: 'review', categories: ['self_harm'], notices: ['help'] };

  it('checks the exact literal only after the core is granted the capability', async () => {
    const [host, folder] = pair();
    const personCheck = vi.fn(async () => review);
    const bridge = new HostBridge(host, asks, { ready: () => bridge.send(grant), personCheck }, 100, 'core');
    const core = await connectCore(folder);
    expect(core.grant.personTextCheck).toBe(true);
    const text = '  You see the tide turn. ';
    const check = core.checkPersonText!(text);
    await expect(check.reply).resolves.toEqual(review);
    expect(personCheck).toHaveBeenCalledWith({ ew: 1, type: 'person.check', id: check.id, text }, expect.any(AbortSignal));
    bridge.close();
  });

  it.each(['page', 'combined'] as const)('does not advertise or accept the check on the %s endpoint', async family => {
    const [host, folder] = pair();
    const personCheck = vi.fn(async () => review);
    const refused = vi.fn();
    const bridge = new HostBridge(host, asks, { ready: () => bridge.send({ ...grant, personTextCheck: true }), personCheck, refused }, 100, family);
    const endpoint = await (family === 'page' ? connectPage(folder) : connect(folder));
    expect(endpoint.grant.personTextCheck).toBeUndefined();
    expect(endpoint).not.toHaveProperty('checkPersonText');
    const reply = new Promise<unknown>(resolve => folder.onMessage(resolve));
    folder.send({ ew: 1, type: 'person.check', id: 90, text: 'private synthetic text' });
    await expect(reply).resolves.toMatchObject({ type: 'reply', reply_to: 90, ok: false, code: 'person_check_unavailable' });
    expect(personCheck).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalledWith(expect.any(String), { type: 'person.check' });
    bridge.close();
  });

  it('fails closed without a handler or when a request or response is malformed', async () => {
    const [oldHost, oldFolder] = pair();
    const oldBridge = new HostBridge(oldHost, asks, { ready: () => oldBridge.send(grant) }, 100, 'core');
    const oldCore = await connectCore(oldFolder);
    expect(oldCore.checkPersonText).toBeUndefined();
    const noHandler = new Promise<unknown>(resolve => oldFolder.onMessage(resolve));
    oldFolder.send({ ew: 1, type: 'person.check', id: 91, text: 'a synthetic line' });
    await expect(noHandler).resolves.toMatchObject({ reply_to: 91, ok: false, code: 'person_check_unavailable' });
    oldBridge.close();

    const [host, folder] = pair();
    const refused = vi.fn();
    const personCheck = vi.fn(async () => ({ ...review, verdict: 'allow' as const, categories: ['classifier_unavailable'] }));
    const bridge = new HostBridge(host, asks, { ready: () => bridge.send(grant), personCheck, refused }, 100, 'core');
    const core = await connectCore(folder);
    const malformed = new Promise<unknown>(resolve => folder.onMessage(resolve));
    folder.send({ ew: 1, type: 'person.check', id: 92, text: 'a synthetic line', actor: 'untrusted' });
    await expect(malformed).resolves.toMatchObject({ reply_to: 92, ok: false });
    expect(refused).toHaveBeenCalledWith('malformed message', { type: 'person.check' });
    expect(personCheck).not.toHaveBeenCalled();
    await expect(core.checkPersonText!('a synthetic line').reply).rejects.toMatchObject({ code: 'person_check_unavailable' });
    bridge.close();
  });

  it('aborts a check by request id and ignores a late result', async () => {
    const [host, folder] = pair();
    let entered!: (signal: AbortSignal) => void;
    let finish!: (result: PersonTextCheckResult) => void;
    const started = new Promise<AbortSignal>(resolve => { entered = resolve; });
    const result = new Promise<PersonTextCheckResult>(resolve => { finish = resolve; });
    const bridge = new HostBridge(host, asks, { ready: () => bridge.send(grant), personCheck: async (_request, signal) => {
      entered(signal);
      return result;
    } }, 100, 'core');
    const core = await connectCore(folder);
    const check = core.checkPersonText!('a synthetic line');
    const signal = await started;
    const reply = expect(check.reply).rejects.toMatchObject({ code: 'cancelled' });
    core.cancel(check.id);
    await reply;
    expect(signal.aborted).toBe(true);
    finish(review);
    bridge.close();
  });
});

it('reports an exact component failure from a page without adding save authority',async()=>{
 const [ph,pf]=pair(),failed=vi.fn(),save=vi.fn();const bridge=new HostBridge(ph,asks,{ready:()=>bridge.send(grant),componentFailed:failed,save},100,'page');
 const page=await connectPage(pf);const failure={bindingDigest:'a'.repeat(64),ref:'@ironwrit/salt-harbor',phase:'mount' as const};page.componentFailed(failure);
 await new Promise(resolve=>setTimeout(resolve,0));expect(failed).toHaveBeenCalledWith(failure);expect('save'in page).toBe(false);expect(save).not.toHaveBeenCalled();bridge.close();
});
it('refuses a bound grant whose component context was dropped',async()=>{
 const [host,folder]=pair();const bridge=new HostBridge(host,asks,{ready:()=>bridge.send({...grant,componentBindingDigest:'a'.repeat(64)})},100,'core');
 await expect(connectCore(folder)).rejects.toThrow('exact component execution binding');bridge.close();
});
