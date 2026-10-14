import { describe, expect, it } from 'vitest';
import { readManifest, readTags, markFolder, HostBridge, Manifest, type Catalog, type Transport, type EngineInterface, type FolderContract } from '../src/index.js';
import { connect } from '../src/loader.js';

/** Salt Harbor, the files page's own example (Section 3). */
const saltHarbor = {
  name: 'Salt Harbor',
  kind: 'reality',
  description: 'A port town on the edge of a drowned quarter',
  version: '3.0.0',
  owner: '@crowsfeather',
  uses: { '@emergent-worlds/narrative-protagonist': '^1' },
  derived_from: [],
  terms: { mode: 'monetize', share: 0.25, credit: 'Salt Harbor by @crowsfeather' },
  entry: { web: 'index.html', headless: 'headless.js' },
  asks: {
    surface: 'full',
    input: ['text', 'pointer'],
    saves: true,
    models: { jobs: ['narration', 'images'] },
    agent: 'read',
    players: 6,
    while_away: true,
    network: [],
  },
  tags: ['intrigue', 'smuggling'],
};

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

  it('reads the platform tags from the fields', () => {
    const m = Manifest.parse({ ...saltHarbor, uses: { '@emergent-worlds/emergence-engine': '^1' }, entry: { ...saltHarbor.entry, installs: { 'linux-x64': 'build/linux' } } });
    expect(readTags(m, () => 'engine')).toEqual(['uses @emergent-worlds/emergence-engine', 'uses a terminal agent', 'installs on your computer']);
  });
});

describe('the marks', () => {
  const engine: EngineInterface = { calls: ['load', 'save', 'advance', 'input', 'read', 'explain', 'forecast', 'change'], takes: ['saves', 'while_away', 'players', 'models'], opens: '*', forecasts: true };
  const packContract: FolderContract = { needs: { calls: ['read', 'change'], state: [] }, adds: { slots: [], gives: [] }, fits: {} };
  const catalog: Catalog = {
    versions: (ref) => (ref.endsWith('narrative-protagonist') ? ['1.0.0', '1.2.0'] : ref.endsWith('emergence-engine') ? ['1.0.0'] : []),
    manifest: () => undefined,
    engineInterface: (ref) => (ref.endsWith('emergence-engine') ? engine : undefined),
    contract: (ref) => (ref.endsWith('narrative-protagonist') ? packContract : undefined),
  };
  const reality = Manifest.parse({ ...saltHarbor, uses: { '@emergent-worlds/narrative-protagonist': '^1', '@emergent-worlds/emergence-engine': '^1' } });

  it('works when everything resolves and the engine takes every ask', () => {
    expect(markFolder(reality, catalog, 'computer', '@emergent-worlds/emergence-engine').mark).toBe('works');
  });

  it("won't work when a folder it uses cannot be found", () => {
    const m = Manifest.parse({ ...saltHarbor, uses: { '@mercerpress/missing': '^1' } });
    expect(markFolder(m, catalog, 'computer')).toEqual({ mark: "won't work", reason: '@mercerpress/missing cannot be found' });
  });

  it('may work when a version is outside the range', () => {
    const m = Manifest.parse({ ...saltHarbor, uses: { '@emergent-worlds/narrative-protagonist': '^2' } });
    expect(markFolder(m, catalog, 'computer').mark).toBe('may work');
  });

  it("won't work when the engine does not take an ask", () => {
    const m = Manifest.parse({ ...reality, asks: { ...reality.asks!, agent: 'change' } });
    expect(markFolder(m, catalog, 'computer', '@emergent-worlds/emergence-engine').mark).toBe("won't work");
  });

  it("won't work on a phone when it only installs", () => {
    const m = Manifest.parse({ ...saltHarbor, entry: { installs: { 'windows-x64': 'build/win' } }, asks: undefined });
    expect(markFolder(m, catalog, 'phone').mark).toBe("won't work");
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

  it('grants, saves, and refuses an unasked job', async () => {
    const [hostSide, folderSide] = pair();
    const saved: string[] = [];
    const bridge = new HostBridge(hostSide, asks, {
      ready: () => bridge.send({ type: 'grant', asks, session: 's1', headless: false, journeys: false, display: { theme: 'dark', textSize: 'default', contrast: 'default', motion: 'full', language: 'en' } }),
      save: async (m) => (saved.push(...m.files.map((f) => f.path)), { version: 'v1' }),
      modelCall: async () => ({ text: 'the tide turns' }),
    });
    const host = await connect(folderSide);
    expect(host.grant.session).toBe('s1');
    await expect(host.save([{ path: 'state/graph.json', sha256: 'a'.repeat(64), data: 'e30=' }])).resolves.toEqual({ version: 'v1' });
    expect(saved).toEqual(['state/graph.json']);
    await expect(host.model('narration', { messages: [{ role: 'user', content: 'go' }] })).resolves.toEqual({ text: 'the tide turns' });
    await expect(host.model('weather', { messages: [{ role: 'user', content: 'go' }] })).rejects.toThrow('names no job weather');
  });

  it('answers the host with the folder handler, and does not deliver what was not asked', async () => {
    const [hostSide, folderSide] = pair();
    const noSaves = { ...asks, saves: false };
    const bridge = new HostBridge(hostSide, noSaves, {
      ready: () => bridge.send({ type: 'grant', asks: noSaves, session: 's2', headless: false, journeys: false, display: { theme: 'light', textSize: 'default', contrast: 'default', motion: 'reduced', language: 'en' } }),
    });
    const host = await connect(folderSide);
    host.handle('state.read', () => ({ day: 9 }));
    await expect(bridge.request({ type: 'state.read', path: '' })).resolves.toEqual({ day: 9 });
    await expect(bridge.request({ type: 'save.request', reason: 'interval' })).rejects.toThrow('not granted');
    expect(bridge.send({ type: 'input', sender: '@ironwrit', kind: 'keys', data: 'w' })).toBe(false);
  });
});
