import {expect, it, vi} from 'vitest';
import {HostBridge, HostMessage, Manifest, ScopedObservation, ScopedObservationInput, type ScopedObservationInput as Input, type Transport} from '../src/index.js';
import {connectCore, connectPage} from '../src/loader.js';
import {endpointSends} from '../src/endpoints.js';
const input = (): Input => ({binding: {hostGeneration: 'host-generation', actorGeneration: 'slot-generation', actor: 'actual-sender', purpose: 'player', operationId: 'one-apply', leaseUntil: 3000}, coreGeneration: 'loaded-core', policyIdentity: 'a'.repeat(64), action: 'apply', proposal: 'p1', decision: 'actual-decision', engine: {hash: 'b'.repeat(64), tick: 1, paths: ['state/engine.json', 'state/graph.json']}, outside: [{path: 'manifest.json', sha256: 'c'.repeat(64)}, {path: 'np/reality.json', sha256: 'd'.repeat(64)}]});
const observed = () => ({input: input(), observationId: 'one-observation', expectedParent: 'confirmed-before-change', observedAt: 1000, validUntil: 2000});
function pair(): [Transport, Transport] {
  const listeners = [new Set<(message: unknown) => void>(), new Set<(message: unknown) => void>()];
  const side = (i: number): Transport => ({send: message => queueMicrotask(() => listeners[1-i]!.forEach(fn => fn(structuredClone(message)))), onMessage: listener => (listeners[i]!.add(listener), () => {listeners[i]!.delete(listener);}), close: () => listeners[i]!.clear()});
  return [side(0), side(1)];
}
const asks = Manifest.parse({name: 'Salt Harbor', kind: 'reality', version: '1.0.0', owner: '@salt_and_ash', entry: {web: 'index.html'}, asks: {surface: 'full', saves: true, agent: 'change'}}).asks!;
const grant = {type: 'grant' as const, asks, session: 'one', headless: false, journeys: false, version: {id: 'v', seq: 1}, display: {theme: 'light' as const, textSize: 'default' as const, contrast: 'default' as const, motion: 'full' as const, language: 'en'}, scopedTransactions: {protocol: 1 as const, hostGeneration: 'host-generation', coreGeneration: 'loaded-core', policyIdentity: 'a'.repeat(64)}};
it('freezes an exact bounded observation vocabulary with disjoint complete path identities', () => {
  expect(ScopedObservation.parse(observed())).toEqual(observed());
  for (const change of [
    {outside: [...input().outside, input().outside[0]]},
    {outside: [{path: 'state/engine.json', sha256: 'c'.repeat(64)}]},
    {engine: {...input().engine, paths: ['state/graph.json', 'state/engine.json']}},
    {outside: [{path: '../manifest.json', sha256: 'c'.repeat(64)}]},
    {outside: [{path: 'manifest.json', sha256: 'unknown'}]},
    {decision: null}, {proposal: null}, {callerApproval: true},
  ]) expect(ScopedObservationInput.safeParse({...input(), ...change}).success).toBe(false);
  expect(ScopedObservationInput.safeParse({...input(), action: 'undo', decision: null}).success).toBe(true);
  expect(ScopedObservationInput.safeParse({...input(), action: 'directive', proposal: null, decision: null}).success).toBe(true);
  for (const change of [{validUntil: 3001}, {observedAt: 2000}, {expectedParent: ''}]) expect(ScopedObservation.safeParse({...observed(), ...change}).success).toBe(false);
});
it('roundtrips private observations on the core and refuses page and transitional combined endpoints', async () => {
  const [h, f] = pair(), observe = vi.fn(async (_message: unknown) => observed());
  const bridge = new HostBridge(h, asks, {ready: () => {bridge.send(grant);}, transactionObserve: observe}, 100, 'core');
  const core = await connectCore(f);
  expect(core.grant.scopedTransactions).toEqual(grant.scopedTransactions);
  expect(await core.observeTransaction!(input())).toEqual(observed());
  expect(observe).toHaveBeenCalledTimes(1);
  expect(observe.mock.calls[0]?.[0]).toMatchObject({type: 'transaction.observe', input: input()});
  bridge.close();
  for (const family of ['page', 'combined'] as const) {
    const [host, folder] = pair(), attempted = vi.fn();
    const b = new HostBridge(host, asks, {transactionObserve: attempted}, 100, family), replies: unknown[] = [];
    folder.onMessage(message => replies.push(message));
    folder.send({ew: 1, type: 'transaction.observe', id: 1, input: input()});
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(replies).toMatchObject([{ok: false}]); expect(attempted).not.toHaveBeenCalled(); b.close();
    expect(endpointSends(family, 'transaction.observe')).toBe(false);
  }
  const [ph, pf] = pair(), pb = new HostBridge(ph, asks, {ready: () => {pb.send(grant);}}, 100, 'page');
  expect('observeTransaction' in await connectPage(pf)).toBe(false); pb.close();
});
it('preserves omitted legacy change messages and requires exact structured private bindings when supplied', () => {
  const legacy = {ew: 1, type: 'change.apply', id: 1, proposal: 'p1', decision: 'd1', approvedBy: 'person'};
  expect(HostMessage.parse(legacy)).toEqual(legacy);
  expect(HostMessage.parse({...legacy, scoped: input().binding})).toEqual({...legacy, scoped: input().binding});
  expect(HostMessage.safeParse({...legacy, scoped: {...input().binding, purpose: 'owner'}}).success).toBe(false);
  expect(HostMessage.safeParse({...legacy, scoped: {...input().binding, leaseUntil: NaN}}).success).toBe(false);
});

import {ScopedHostTransactions, type ScopedHostAuthority} from '../src/scoped-transactions.js';
function hostGate() {
  let tail: Promise<unknown> = Promise.resolve(), clock = 1000, current = true, number = 0;
  const tree = {parent: 'confirmed-before-change', files: [...input().outside, ...input().engine.paths.map(path => ({path, sha256: 'e'.repeat(64)}))]};
  const gate = new ScopedHostTransactions({grant: grant.scopedTransactions, exclusive(work) {const next = tail.then(work, work); tail = next.catch(() => {}); return next;}, assertCurrent() {if (!current) throw Error('core lost');}, tree: () => tree, now: () => clock, id: () => `unique-${++number}`});
  let actorCurrent = true;
  const authority: ScopedHostAuthority = {actor: input().binding.actor, actorGeneration: input().binding.actorGeneration, purpose: 'player', leaseUntil: 3000, assertCurrent() {if (!actorCurrent) throw Error('actor lost');}, authorize: async () => {}};
  return {gate, tree, authority, expire: () => {clock = 3000;}, revoke: () => {actorCurrent = false;}, close: () => {current = false;}};
}
const operation = {action: 'apply' as const, proposal: 'p1', decision: 'actual-decision'};
it('requires the original live gated operation and issues one observation after current authority', async () => {
  const {gate, authority} = hostGate();
  await expect(gate.observe(input())).rejects.toThrow('matching original');
  await gate.run(authority, operation, async binding => {
    await expect(gate.observe({...input(), binding: {...binding, actorGeneration: 'replacement-slot'}})).rejects.toThrow('matching original');
    const exact = {...input(), binding};
    expect(await gate.observe(exact)).toMatchObject({input: exact, expectedParent: 'confirmed-before-change', observedAt: 1000, validUntil: 3000});
    await expect(gate.observe(exact)).rejects.toThrow('matching original');
  });
});
it('rechecks actor, core, lease and complete outside files after a held authority await', async () => {
  for (const failure of ['actor', 'core', 'lease', 'asset', 'deletion'] as const) {
    const h = hostGate(); let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => {entered = resolve;}), wait = new Promise<void>(resolve => {release = resolve;});
    h.authority.authorize = async () => {entered(); await wait;};
    const pending = h.gate.run(h.authority, operation, async binding => h.gate.observe({...input(), binding}));
    await started;
    if (failure === 'actor') h.revoke();
    if (failure === 'core') h.close();
    if (failure === 'lease') h.expire();
    if (failure === 'asset') h.tree.files.push({path: 'art/harbor.png', sha256: 'f'.repeat(64)});
    if (failure === 'deletion') h.tree.files = h.tree.files.filter(file => file.path !== 'manifest.json');
    release(); await expect(pending).rejects.toThrow();
  }
});
it('shares the actual operation queue and captures callbacks before awaits', async () => {
  const h = hostGate(), events: string[] = []; let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;}), wait = new Promise<void>(resolve => {release = resolve;});
  const first = h.gate.run(h.authority, operation, async binding => {events.push('first'); entered(); await wait; await h.gate.observe({...input(), binding}); events.push('first-finished');});
  await started;
  const second = h.gate.run(h.authority, operation, async binding => {events.push('second'); await h.gate.observe({...input(), binding});});
  expect(events).toEqual(['first']);
  h.authority.authorize = async () => {throw Error('replaced callback');};
  release(); await Promise.all([first, second]);
  expect(events).toEqual(['first', 'first-finished', 'second']);
});
it('blocks fresh mutations after unknown inverse persistence without repeating the inverse', async () => {
  const h = hostGate(); let inverses = 0;
  await expect(h.gate.run(h.authority, {action: 'undo', proposal: 'p1', decision: null}, async binding => {
    await h.gate.observe({...input(), binding, action: 'undo', decision: null});
    inverses++; h.gate.blockRecovery(); throw Error('original save outcome unknown');
  })).rejects.toThrow('save outcome unknown');
  await expect(h.gate.run(h.authority, operation, async () => {inverses++;})).rejects.toThrow('persisted core reloaded');
  expect(inverses).toBe(1);
});
