import { describe, expect, it } from 'vitest';
import {
  readManifest,
  readTags,
  markFolder,
  resolveEntry,
  resolveUses,
  askParts,
  HostBridge,
  Manifest,
  EngineInterface,
  FolderContract,
  Proposal,
  callPort,
  servePort,
  type Catalog,
  type Transport,
} from '../src/index.js';
import { connect } from '../src/loader.js';

/** Salt Harbor, the files page's own example (Section 3). */
const saltHarbor = {
  name: 'Salt Harbor',
  kind: 'reality',
  description: 'A port town on the edge of a drowned quarter',
  version: '3.0.0',
  owner: '@crowsfeather',
  uses: { '@emergentworlds/narrative-protagonist': '^1' },
  derived_from: [],
  terms: { mode: 'monetize', share: 0.25, credit: 'Salt Harbor by @crowsfeather' },
  entry: { web: 'index.html', headless: 'headless.js' },
  asks: {
    surface: 'full',
    input: ['text', 'pointer'],
    saves: true,
    models: { jobs: ['narration', 'characters', 'mechanics'], image_jobs: ['images'] },
    agent: 'read',
    players: 6,
    while_away: true,
    network: [],
  },
  tags: ['intrigue', 'smuggling'],
};

const display = { theme: 'dark', textSize: 'default', contrast: 'default', motion: 'full', language: 'en' } as const;
const grantRest = { session: 's1', headless: false, journeys: false, display, version: { id: 'v0', seq: 0 } };

describe('the manifest', () => {
  it('reads Salt Harbor', () => {
    const r = readManifest(JSON.stringify(saltHarbor));
    expect(r.valid).toBe(true);
  });

  it('keeps an invalid manifest readable, with its issues', () => {
    const r = readManifest(JSON.stringify({ ...saltHarbor, version: 'three' }));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.issues[0]?.path).toBe('version');
  });

  it('refuses more than ten people (PV24)', () => {
    const r = readManifest(JSON.stringify({ ...saltHarbor, asks: { ...saltHarbor.asks, players: 11 } }));
    expect(r.valid).toBe(false);
  });

  it('needs a headless module to run while away or with others', () => {
    const r = readManifest(JSON.stringify({ ...saltHarbor, entry: { web: 'index.html' } }));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.issues.some((i) => i.path === 'entry.headless')).toBe(true);
  });

  it('lets a Reality with no entry of its own make asks when it uses a folder that has one (D5)', () => {
    const { entry: _entry, ...noEntry } = saltHarbor;
    expect(readManifest(JSON.stringify(noEntry)).valid).toBe(true);
    const alone = readManifest(JSON.stringify({ ...noEntry, uses: {} }));
    expect(alone.valid).toBe(false);
    if (!alone.valid) expect(alone.issues[0]?.path).toBe('asks');
  });

  it('reads the platform tags from the fields', () => {
    const m = Manifest.parse({ ...saltHarbor, uses: { '@emergentworlds/emergence-engine': '^1' }, entry: { ...saltHarbor.entry, installs: { 'linux-x64': 'build/linux' } } });
    expect(readTags(m, () => 'engine')).toEqual(['uses @emergentworlds/emergence-engine', 'uses a terminal agent', 'installs on your computer']);
  });

  it('lists the ask parts a folder must take, the agent to read and to change among them', () => {
    expect(askParts(Manifest.parse(saltHarbor))).toEqual(['saves', 'while_away', 'players', 'agent.read', 'models']);
    expect(askParts(Manifest.parse({ ...saltHarbor, asks: { ...saltHarbor.asks, agent: 'change' } }))).toContain('agent.change');
  });
});

describe('the interface and contract files', () => {
  it('reads the Emergence Engine interface with its module, state parts, and format', () => {
    const i = EngineInterface.parse({ calls: ['load', 'save', 'advance', 'input', 'read', 'query', 'explain', 'forecast', 'change'], takes: ['saves', 'agent.read', 'agent.change', 'models'], opens: '^1.0.0', forecasts: true, module: 'dist/engine.js', state: ['header', 'variables', 'values', 'relationships', 'mechanics', 'record', 'slots'], parts: { graph: 'dist/graph.js' } });
    expect(i.format).toBe(1);
    expect(i.parts.graph).toBe('dist/graph.js');
  });

  it('reads a pack contract with the slots it gives, what it recommends, and what it keeps', () => {
    const c = FolderContract.parse({
      needs: { calls: ['read', 'change'], state: ['variables', 'record'] },
      adds: { gives: ['dashboard-line', 'scene-picture', 'artifact-item'] },
      fits: { '@emergentworlds/emergence-engine': '^1' },
      module: 'dist/core.js',
      recommends: { narration: 'test.large', mechanics: 'test.small' },
      keeps: [{ prefix: 'np/', description: 'the pack slice: player, scene, pins' }],
    });
    expect(c.adds.gives).toContain('scene-picture');
    expect(c.recommends.narration).toBe('test.large');
  });

  it('refuses a slot the contract does not name', () => {
    expect(FolderContract.safeParse({ adds: { slots: ['weather'] } }).success).toBe(false);
  });
});

describe('the marks', () => {
  const engine: EngineInterface = EngineInterface.parse({ calls: ['load', 'save', 'advance', 'input', 'read', 'explain', 'forecast', 'change'], takes: ['saves', 'while_away', 'players', 'agent.read', 'models'], opens: '*', forecasts: true, state: ['variables', 'record'] });
  const packManifest = Manifest.parse({ name: 'narrative-protagonist', kind: 'pack', version: '1.2.0', owner: '@emergentworlds', uses: { '@emergentworlds/emergence-engine': '^1' }, entry: { web: 'dist/index.html', headless: 'dist/core.js' } });
  const packContract: FolderContract = FolderContract.parse({ needs: { calls: ['read', 'change'], state: ['variables'] }, adds: {}, fits: {} });
  const catalog: Catalog = {
    versions: (ref) => (ref.endsWith('narrative-protagonist') ? ['1.0.0', '1.2.0'] : ref.endsWith('emergence-engine') ? ['1.0.0'] : []),
    manifest: (ref) => (ref.endsWith('narrative-protagonist') ? packManifest : undefined),
    engineInterface: (ref) => (ref.endsWith('emergence-engine') ? engine : undefined),
    contract: (ref) => (ref.endsWith('narrative-protagonist') ? packContract : undefined),
  };
  const reality = Manifest.parse({ ...saltHarbor, uses: { '@emergentworlds/narrative-protagonist': '^1', '@emergentworlds/emergence-engine': '^1' } });

  it('reaches the engine through the pack, as a Reality names only its pack (0.3.0)', () => {
    const viaPack = Manifest.parse({ ...saltHarbor, uses: { '@emergentworlds/narrative-protagonist': '^1' } });
    expect(markFolder(viaPack, catalog, 'computer', '@emergentworlds/emergence-engine').mark).toBe('works');
  });

  it('works when everything resolves and the engine takes every ask', () => {
    expect(markFolder(reality, catalog, 'computer', '@emergentworlds/emergence-engine').mark).toBe('works');
    // Pictures (the operator, 2026-10-15): optional unless the manifest needs them.
    const none = { available: false, reason: 'pictures are not made on this key' };
    expect(markFolder(reality, catalog, 'computer', '@emergentworlds/emergence-engine', none)).toEqual({ mark: 'may work', reason: 'pictures are not made on this key' });
    const needs = Manifest.parse({ ...reality, asks: { ...reality.asks, models: { ...reality.asks!.models!, pictures: 'needed' } } });
    expect(markFolder(needs, catalog, 'computer', '@emergentworlds/emergence-engine', none)).toEqual({ mark: "won't work", reason: 'pictures are not made on this key' });
    expect(markFolder(needs, catalog, 'computer', '@emergentworlds/emergence-engine', { available: true, reason: '' }).mark).toBe('works');
  });

  it("won't work when a folder it uses cannot be found", () => {
    const m = Manifest.parse({ ...saltHarbor, uses: { '@mercerpress/missing': '^1' } });
    expect(markFolder(m, catalog, 'computer')).toEqual({ mark: "won't work", reason: '@mercerpress/missing cannot be found' });
  });

  it('may work when a version is outside the range', () => {
    const m = Manifest.parse({ ...saltHarbor, uses: { '@emergentworlds/narrative-protagonist': '^2' } });
    expect(markFolder(m, catalog, 'computer').mark).toBe('may work');
  });

  it("won't work when the engine does not take an ask", () => {
    const m = Manifest.parse({ ...reality, asks: { ...reality.asks!, agent: 'change' } });
    expect(markFolder(m, catalog, 'computer', '@emergentworlds/emergence-engine')).toEqual({ mark: "won't work", reason: '@emergentworlds/emergence-engine does not take the agent.change ask' });
  });

  it("won't work when a pack needs a part of the state the engine does not document", () => {
    const needy: Catalog = { ...catalog, contract: () => FolderContract.parse({ needs: { state: ['dispositions'] } }) };
    expect(markFolder(reality, needy, 'computer', '@emergentworlds/emergence-engine').mark).toBe("won't work");
  });

  it("won't work on a phone when it only installs", () => {
    const m = Manifest.parse({ ...saltHarbor, entry: { installs: { 'windows-x64': 'build/win' } }, asks: undefined });
    expect(markFolder(m, catalog, 'phone').mark).toBe("won't work");
  });

  it('takes the entry from the pack when the Reality names none (D5)', () => {
    const { entry: _entry, ...noEntry } = reality;
    const m = Manifest.parse(noEntry);
    const { resolved } = resolveUses(m, catalog);
    expect(resolved.get('@emergentworlds/narrative-protagonist')).toBe('1.2.0');
    expect(resolveEntry(m, catalog, resolved)).toEqual({ ref: '@emergentworlds/narrative-protagonist', entry: packManifest.entry });
    expect(markFolder(m, catalog, 'computer', '@emergentworlds/emergence-engine').mark).toBe('works');
    const nowhere: Catalog = { ...catalog, manifest: () => undefined };
    expect(markFolder(m, nowhere, 'computer').mark).toBe("won't work");
  });
});

/** Two transports joined back to back, as a MessageChannel's two ports are. */
function pair(): [Transport, Transport] {
  const listeners: [((m: unknown) => void)[], ((m: unknown) => void)[]] = [[], []];
  const side = (me: 0 | 1): Transport => ({
    send: (m) => queueMicrotask(() => listeners[1 - me]!.forEach((l) => l(structuredClone(m)))),
    onMessage: (l) => (listeners[me].push(l), () => void 0),
    close: () => void 0,
  });
  return [side(0), side(1)];
}

describe('the bridge and the loader', () => {
  const asks = Manifest.parse(saltHarbor).asks!;

  it('grants with the version, the tree, and the uses; saves for a reason; refuses an unasked job', async () => {
    const [hostSide, folderSide] = pair();
    const saved: { reason: string; paths: string[] }[] = [];
    const bridge = new HostBridge(hostSide, asks, {
      ready: () =>
        bridge.send({
          type: 'grant',
          asks,
          ...grantRest,
          files: [{ path: 'state/engine.json', sha256: 'b'.repeat(64), size: 12 }],
          uses: [{ ref: '@emergentworlds/narrative-protagonist', version: '1.2.0', kind: 'pack' }],
        }),
      save: async (m) => (saved.push({ reason: m.reason, paths: m.files.map((f) => f.path) }), { version: 'v1', seq: 1, at: 'now' }),
      modelCall: async () => ({ text: 'the tide turns' }),
    });
    const host = await connect(folderSide);
    expect(host.grant.session).toBe('s1');
    expect(host.grant.files[0]?.path).toBe('state/engine.json');
    expect(host.grant.uses[0]?.kind).toBe('pack');
    await expect(host.save('own', [{ path: 'state/graph.json', sha256: 'a'.repeat(64), data: 'e30=' }])).resolves.toEqual({ version: 'v1', seq: 1, at: 'now' });
    expect(saved).toEqual([{ reason: 'own', paths: ['state/graph.json'] }]);
    await expect(host.model('narration', { kind: 'text', messages: [{ role: 'user', content: 'go' }] }).reply).resolves.toEqual({ text: 'the tide turns' });
    await expect(host.model('weather', { kind: 'text', messages: [{ role: 'user', content: 'go' }] }).reply).rejects.toThrow('names no text job weather');
    await expect(host.model('narration', { kind: 'image', prompt: 'the harbor at dawn' }).reply).rejects.toThrow('names no image job narration');
    await expect(host.model('images', { kind: 'image', prompt: 'the harbor at dawn' }).reply).resolves.toEqual({ text: 'the tide turns' });
  });

  it('asks for a save and resolves with the committed version once the folder has saved (D8)', async () => {
    const [hostSide, folderSide] = pair();
    const bridge = new HostBridge(hostSide, asks, {
      ready: () => bridge.send({ type: 'grant', asks, ...grantRest }),
      save: async (m) => ({ version: `v-${m.reason}`, seq: 2, at: 'now', name: m.name }),
    });
    const host = await connect(folderSide);
    host.on('save.request', (m) => void host.save(m.reason, [{ path: 'state/engine.json', sha256: 'c'.repeat(64) }], m.name));
    await expect(bridge.requestSave('before-change', 'before: a royal bank')).resolves.toEqual({ version: 'v-before-change', seq: 2, at: 'now', name: 'before: a royal bank' });
  });

  it('streams a model reply paragraph by paragraph and cancels a pending call', async () => {
    const [hostSide, folderSide] = pair();
    const bridge = new HostBridge(hostSide, asks, {
      ready: () => bridge.send({ type: 'grant', asks, ...grantRest }),
      modelCall: (m, part, signal) =>
        new Promise((resolve, reject) => {
          part(0, 'The tide turns.');
          part(1, 'The council sits.');
          if (m.request.kind === 'text' && m.request.messages[0]?.content === 'slow') {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          } else {
            resolve({ text: 'The tide turns.\n\nThe council sits.' });
          }
        }),
    });
    const host = await connect(folderSide);
    const parts: string[] = [];
    const { reply } = host.model('narration', { kind: 'text', messages: [{ role: 'user', content: 'go' }], stream: true }, (_i, text) => parts.push(text));
    await expect(reply).resolves.toEqual({ text: 'The tide turns.\n\nThe council sits.' });
    expect(parts).toEqual(['The tide turns.', 'The council sits.']);
    const slow = host.model('narration', { kind: 'text', messages: [{ role: 'user', content: 'slow' }] });
    await new Promise((r) => setTimeout(r, 5));
    host.cancel(slow.id);
    await expect(slow.reply).rejects.toThrow('cancelled');
  });

  it('pauses with a reply, reads a file, picks a file, keeps prefs, and takes a decision', async () => {
    const [hostSide, folderSide] = pair();
    const prefs: unknown[] = [];
    const bridge = new HostBridge(hostSide, asks, {
      ready: () => bridge.send({ type: 'grant', asks, ...grantRest, prefs: { background: 'dark' } }),
      fileRead: async (path) => ({ data: Buffer.from(`file ${path}`).toString('base64') }),
      filePick: async () => ({ name: 'dawn.jpg', mime: 'image/jpeg', data: 'AAAA' }),
      prefsSet: async (p) => (prefs.push(p), { ok: true }),
      agentAsk: async () => ({ text: 'That changes the Reality.', decision: { id: 'd1', text: 'Put a million in the treasury.', choices: ['do it', 'never mind'] } }),
      agentDecide: async (m) => ({ decision: m.decision, choice: m.choice, made: m.choice === 'do it' }),
    });
    const host = await connect(folderSide);
    expect(host.grant.prefs).toEqual({ background: 'dark' });
    host.handle('pause', () => ({ paused: true, at: 1440 }));
    await expect(bridge.request({ type: 'pause' })).resolves.toEqual({ paused: true, at: 1440 });
    expect(Buffer.from(await host.read('state/engine.json'), 'base64').toString()).toBe('file state/engine.json');
    await expect(host.pick(['image/*'])).resolves.toEqual({ name: 'dawn.jpg', mime: 'image/jpeg', data: 'AAAA' });
    await host.prefs({ background: 'an image' });
    expect(prefs).toEqual([{ background: 'an image' }]);
    const answer = (await host.agent('Put a million in the treasury')) as { decision: { id: string } };
    await expect(host.decide(answer.decision.id, 'do it')).resolves.toEqual({ decision: 'd1', choice: 'do it', made: true });
  });

  it('answers the host with the folder handler, and does not deliver what was not asked', async () => {
    const [hostSide, folderSide] = pair();
    const noSaves = { ...asks, saves: false, surface: 'none' as const };
    const bridge = new HostBridge(hostSide, noSaves, {
      ready: () => bridge.send({ type: 'grant', asks: noSaves, ...grantRest }),
    });
    const host = await connect(folderSide);
    host.handle('state.read', () => ({ day: 9 }));
    host.handle('state.query', (m) => ({ items: [], omitted: Object.keys(m.query) }));
    host.handle('change.propose', (m) => Proposal.parse({ proposal: 'p1', preview: { adds: [{ text: `${m.change.intent}: the Royal Bank` }] }, forecast: { available: false, reason: 'this engine cannot forecast' } }));
    await expect(bridge.request({ type: 'state.read', path: '' })).resolves.toEqual({ day: 9 });
    await expect(bridge.request({ type: 'state.query', query: { kind: 'variable', tags: ['money'] } })).resolves.toMatchObject({ omitted: expect.arrayContaining(['kind', 'tags']) });
    const proposal = (await bridge.request({ type: 'change.propose', change: { intent: 'establish a royal bank' } })) as Proposal;
    expect(proposal.preview.adds[0]?.text).toBe('establish a royal bank: the Royal Bank');
    expect(proposal.forecast.available).toBe(false);
    await expect(bridge.requestSave('interval')).rejects.toThrow('not granted');
    await expect(bridge.request({ type: 'layout.set', layout: {} })).rejects.toThrow('not granted');
    expect(bridge.send({ type: 'input', sender: '@ironwrit', kind: 'keys', data: 'w' })).toBe(false);
  });
});

describe("the folder's own port", () => {
  it('calls the core by name, hears its notices, and refuses an unknown call', async () => {
    const [pageSide, coreSide] = pair();
    const core = servePort(coreSide, {
      read: async (args) => ({ path: (args as { path: string }).path, day: 21 }),
      'np.scene': async () => ({ location: 'the harbor' }),
    });
    const page = callPort(pageSide);
    const events: unknown[] = [];
    page.on('event', (d) => events.push(d));
    await expect(page.call('read', { path: 'variables/tide' })).resolves.toEqual({ path: 'variables/tide', day: 21 });
    await expect(page.call('np.scene')).resolves.toEqual({ location: 'the harbor' });
    await expect(page.call('weather')).rejects.toThrow('weather is not a call of this core');
    core.notify('event', { level: 'notable', text: 'the moneylender appears' });
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual([{ level: 'notable', text: 'the moneylender appears' }]);
  });
});

describe('requests as a folder writes them (ew-host 0.2.2)', () => {
  it('reads a model request with no kind as a text request (R1)', async () => {
    const { ModelRequest } = await import('../src/protocol.js');
    expect(ModelRequest.parse({ messages: [{ role: 'user', content: 'The tide at Salt Harbor' }] })).toMatchObject({ kind: 'text', stream: false });
    expect(ModelRequest.parse({ kind: 'image', prompt: 'The harbour bell at dusk' })).toMatchObject({ kind: 'image', width: 1024 });
  });
  it('keeps the query fields an engine does not know, so it can report them (R3)', async () => {
    const { StateQuery } = await import('../src/protocol.js');
    expect(StateQuery.parse({ kind: 'variable', mood: 'calm' })).toMatchObject({ kind: 'variable', mood: 'calm', limit: 50 });
  });
});

describe('the pack asks of the App (ew-host 0.2.3)', () => {
  it('grants the routing call to a folder that asks for the agent, without naming it in jobs', async () => {
    const { permitted, FolderMessage } = await import('../src/protocol.js');
    const call = FolderMessage.parse({ ew: 1, id: 1, type: 'model.call', job: 'agent.route', request: { messages: [{ role: 'user', content: 'ring the harbour bell' }], maxTokens: 4 } });
    const asks = Manifest.parse(saltHarbor).asks!;
    expect(permitted(call, asks)).toEqual({ ok: true });
    expect(permitted(call, { ...asks, agent: 'none' }).ok).toBe(false);
  });
  it('lets a folder ask the App to open its own surfaces', async () => {
    const { FolderMessage } = await import('../src/protocol.js');
    expect(FolderMessage.parse({ ew: 1, type: 'app.open', what: 'start-from', detail: 'the first moment' })).toMatchObject({ what: 'start-from' });
  });
});
