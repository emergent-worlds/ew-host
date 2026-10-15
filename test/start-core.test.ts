/**
 * The classic bootstrap of `startCore` (the App's request 9), run against a worker's global
 * scope made of an EventTarget, with the core's import in the test's hands. The browsers run
 * it in scripts/worker-check.mjs.
 */
import { describe, expect, it } from 'vitest';
import { coreBootstrap } from '../src/start-core.js';

const CORE = 'http://127.0.0.1:4000/dist/core.js';

/** Runs the bootstrap with `import()` replaced by one the test settles, and timers held. */
function run() {
  const scope = new EventTarget();
  let settle!: { resolve: () => void; reject: (e: unknown) => void };
  const imported: string[] = [];
  const timers: (() => void)[] = [];
  const source = coreBootstrap(CORE).replace('import(', '__import(');
  const fn = new Function('self', '__import', 'MessageEvent', 'setTimeout', source);
  fn(
    scope,
    (url: string) => {
      imported.push(url);
      return new Promise<void>((resolve, reject) => (settle = { resolve, reject }));
    },
    MessageEvent,
    (f: () => void) => timers.push(f),
  );
  return { scope, imported, timers, settle: () => settle };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('startCore\'s classic bootstrap (ew-host 0.3.3)', () => {
  it('imports the core by its absolute URL', () => {
    expect(run().imported).toEqual([CORE]);
    expect(coreBootstrap('http://x/"a".js')).toContain('import("http://x/\\"a\\".js")');
  });

  it('holds the messages that arrive before the core listens and dispatches them again in order, with their ports', async () => {
    const { scope, settle } = run();
    const port = new MessageChannel().port1;
    const early: unknown[] = [];
    // A listener the core adds while its evaluation is under way sees nothing until it has loaded.
    scope.addEventListener('message', (e) => early.push((e as MessageEvent).data));
    scope.dispatchEvent(new MessageEvent('message', { data: { ewHost: 1 }, ports: [port] }));
    scope.dispatchEvent(new MessageEvent('message', { data: { npPort: 1 } }));
    expect(early).toEqual([]);

    const seen: { data: unknown; port: unknown }[] = [];
    scope.addEventListener('message', (e) => seen.push({ data: (e as MessageEvent).data, port: (e as MessageEvent).ports[0] }));
    settle().resolve();
    await flush();
    expect(early).toEqual([{ ewHost: 1 }, { npPort: 1 }]);
    expect(seen).toEqual([
      { data: { ewHost: 1 }, port },
      { data: { npPort: 1 }, port: undefined },
    ]);

    // Once the core is listening, a message goes straight to it, once.
    scope.dispatchEvent(new MessageEvent('message', { data: { late: 1 } }));
    expect(seen.map((s) => s.data)).toEqual([{ ewHost: 1 }, { npPort: 1 }, { late: 1 }]);
    port.close();
  });

  it('throws a core that does not load from the worker\'s global scope, and holds nothing after', async () => {
    const { scope, settle, timers } = run();
    const failure = new TypeError('Failed to fetch dynamically imported module');
    settle().reject(failure);
    await flush();
    expect(timers).toHaveLength(1);
    expect(() => timers[0]!()).toThrow(failure);
    const seen: unknown[] = [];
    scope.addEventListener('message', (e) => seen.push((e as MessageEvent).data));
    scope.dispatchEvent(new MessageEvent('message', { data: 1 }));
    expect(seen).toEqual([1]);
  });
});
