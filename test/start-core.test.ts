/**
 * The classic bootstrap of `startCore` (the App's request 9), run against a worker's global
 * scope made of an EventTarget, with the core's import in the test's hands. The browsers run
 * it in scripts/worker-check.mjs.
 */
import { describe, expect, it, vi } from 'vitest';
import { coreBootstrap, startCore } from '../src/start-core.js';

const CORE = 'http://127.0.0.1:4000/dist/core.js';

/** Runs the bootstrap with `import()` replaced by one the test settles, and timers held. */
function run() {
  const reports:unknown[]=[];
  const scope = Object.assign(new EventTarget(),{postMessage:(value:unknown)=>reports.push(value)});
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
  return { scope, imported, timers, reports, settle: () => settle };
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

for(const [error,kind] of [[new SyntaxError('invalid code'),'exception'],[new Error('top-level throw'),'exception'],[new TypeError('network or ambiguous code'),'unavailable'],[null,'unavailable']] as const){
 it(`reports ${kind} before throwing the original import failure`,async()=>{
  const {settle,reports,timers}=run();settle().reject(error);await flush();
  expect(reports).toEqual([{ewCoreImportFailure:1,url:CORE,kind}]);expect(timers).toHaveLength(1);
 });
}

it('binds the optional report to this worker and exact core URL, once',()=>{
 const worker=new EventTarget(),reported=vi.fn();
 vi.stubGlobal('Worker',class {constructor(){return worker;}});vi.stubGlobal('location',{href:'http://127.0.0.1:4000/dist/page.html'});
 const blob=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:fixture');
 try{
  startCore('./core.js',{onImportFailure:reported});
  for(const data of [null,{ewCoreImportFailure:1,url:'http://elsewhere/core.js',kind:'exception'},{ewCoreImportFailure:1,url:CORE,kind:'unknown'}])worker.dispatchEvent(new MessageEvent('message',{data}));
  expect(reported).not.toHaveBeenCalled();
  worker.dispatchEvent(new MessageEvent('message',{data:{ewCoreImportFailure:1,url:CORE,kind:'exception'}}));
  worker.dispatchEvent(new MessageEvent('message',{data:{ewCoreImportFailure:1,url:CORE,kind:'unavailable'}}));
  expect(reported).toHaveBeenCalledExactlyOnceWith({kind:'exception'});
 }finally{blob.mockRestore();vi.unstubAllGlobals();}
});
