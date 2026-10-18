/**
 * Starting a folder's core from a page in the App's frame. This module imports
 * nothing, so a browser can load it from `dist/` as it is (scripts/worker-check.mjs).
 *
 * A sandboxed page has an opaque origin and cannot start a worker from its own URL
 * (the App's request 4). Chromium, the engine of WebView2 and of Android's WebView,
 * also refuses a module worker from a `blob:` URL in such a page: the worker fires
 * an error event before it runs (the App's request 9). A classic worker from a
 * `blob:` URL runs in Chromium, WebKit, and Gecko, and imports the core with a
 * dynamic `import()`, so the bootstrap is classic.
 *
 * A classic worker takes messages once its script has run, before the core's import
 * has resolved, so the bootstrap holds every message that arrives meanwhile and
 * dispatches each again, with its ports, once the core is listening. A held message
 * reaches no other listener while it is held, so a core whose evaluation spans tasks
 * (a top level `await`) does not see it twice. A core that does not load is thrown
 * from the worker's global scope, which the page sees as the worker's error event.
 */

/** The classic bootstrap's source for a core at an absolute URL. */
export function coreBootstrap(absoluteUrl: string): string {
  const url = JSON.stringify(absoluteUrl);
  return [
    '"use strict";',
    '{',
    'const held = [];',
    'const hold = (e) => { e.stopImmediatePropagation(); held.push(e); };',
    'self.addEventListener("message", hold);',
    `import(${url}).then(`,
    '  () => {',
    '    self.removeEventListener("message", hold);',
    '    for (const e of held) self.dispatchEvent(new MessageEvent("message", { data: e.data, ports: [...e.ports] }));',
    '  },',
    '  (error) => {',
    '    self.removeEventListener("message", hold);',
    '    const exception = error instanceof Error && ["Error","SyntaxError","ReferenceError","RangeError","EvalError","URIError"].includes(error.name);',
    `    self.postMessage({ ewCoreImportFailure: 1, url: ${url}, kind: exception ? "exception" : "unavailable" });`,
    '    setTimeout(() => { throw error; });',
    '  },',
    ');',
    '}',
    '',
  ].join('\n');
}

/**
 * Starts a folder's core in a dedicated worker from a page in the App's frame,
 * through a classic `blob:` bootstrap that imports the core by its absolute URL
 * (the frame's policy allows `blob:` workers). Pass the core's URL, absolute or
 * relative to the page. The core is an ES module and runs as one.
 */
export type CoreImportFailure = {kind:'exception'|'unavailable'};
export function startCore(url: string, options?:{onImportFailure?(failure:CoreImportFailure):void}): Worker {
  const absolute = new URL(url, location.href).href;
  const bootstrap = URL.createObjectURL(new Blob([coreBootstrap(absolute)], { type: 'text/javascript' }));
  const worker = new Worker(bootstrap);
  if(options?.onImportFailure){
    const failed=(event:MessageEvent)=>{
      const value=event.data as {ewCoreImportFailure?:unknown;url?:unknown;kind?:unknown}|null;
      if(value?.ewCoreImportFailure!==1||value.url!==absolute||(value.kind!=='exception'&&value.kind!=='unavailable'))return;
      worker.removeEventListener('message',failed);
      options.onImportFailure!({kind:value.kind});
    };
    worker.addEventListener('message',failed);
  }
  return worker;
}
