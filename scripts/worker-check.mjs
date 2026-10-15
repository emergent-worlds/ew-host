// Checks `startCore` in the App's frame on each browser engine: Chromium (WebView2, Android's
// WebView), WebKit (WKWebView), and Gecko. Run `pnpm build` first; `pnpm check:worker` does both.
//
// Two servers on 127.0.0.1 with ports of their own: the parent page, and the frame's mount, which
// serves the frame with the App's headers and policy (ew-app src/frame/csp.ts) and is loaded in an
// iframe sandboxed with `allow-scripts` only, so its origin is opaque. The frame takes a port from
// the parent as the App hands one, starts the core with ew-host's `startCore` from dist/, and hands
// the core that port and a second port of its own, as the pack's page does. The core imports a
// module under /uses/ statically and another dynamically, the second loading a small WebAssembly
// module; both are served late, so the handoffs arrive before the core listens, and a third
// message arrives while the core awaits its dynamic import. Each case passes when both ports reach
// the core once each, the late message once, and the WebAssembly answers.
//
// Usage: node scripts/worker-check.mjs [chromium] [webkit] [firefox]   (all three by default; the
// browsers come from `pnpm exec playwright install chromium webkit firefox`)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, webkit, firefox } from 'playwright';

const START_CORE = readFileSync(fileURLToPath(new URL('../dist/start-core.js', import.meta.url)), 'utf8');
// (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
const ADD_WASM = Buffer.from('0061736d0100000001070160027f7f017f030201000707010361646400000a09010700200020016a0b', 'hex');
const STATIC_DELAY_MS = 400;
const DYNAMIC_DELAY_MS = 900;
const LATE_AT_MS = 800;

/** The App's frame policy, with `{origin}` for the mount's origin. */
const csp = (origin) =>
  [
    "default-src 'none'",
    `script-src ${origin} 'wasm-unsafe-eval'`,
    `worker-src ${origin} blob:`,
    `connect-src ${origin}`,
    `img-src ${origin} data: blob:`,
    `style-src ${origin} 'unsafe-inline'`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

const FRAME_HTML = '<!doctype html><meta charset="utf-8"><title>frame</title><script type="module" src="/frame.js"></script>';

// The frame's page: the App's handoff, then the core started as the case says.
const FRAME_JS = `
import { startCore } from '/start-core.js';
const form = new URLSearchParams(location.search).get('form');
const core = new URLSearchParams(location.search).get('core');
const tell = (m) => parent.postMessage({ check: 1, ...m }, '*');
function start(url) {
  if (form === 'module') {
    // The bootstrap of ew-host 0.3.0 to 0.3.2, for comparison.
    const abs = new URL(url, location.href).href;
    return new Worker(URL.createObjectURL(new Blob(['import ' + JSON.stringify(abs) + ';'], { type: 'text/javascript' })), { type: 'module' });
  }
  return startCore(url);
}
window.addEventListener('message', (e) => {
  if (e.source !== parent || e.data?.ewHost !== 1 || !e.ports[0]) return;
  tell({ step: 'frame', origin: self.origin });
  let worker;
  try {
    worker = start(core);
  } catch (err) {
    tell({ step: 'construct-threw', message: String(err) });
    return;
  }
  worker.addEventListener('error', (ev) => tell({ step: 'error', message: ev.message || ev.type }));
  worker.postMessage({ ewHost: 1 }, [e.ports[0]]);
  const own = new MessageChannel();
  worker.postMessage({ npPort: 1 }, [own.port2]);
  own.port1.onmessage = (m) => tell({ step: 'pack-reply', reply: m.data });
  setTimeout(() => worker.postMessage({ late: 1 }), ${LATE_AT_MS});
});
`;

// The core: listens at its top level, then awaits a dynamic import while a message arrives.
const CORE_JS = `
import { label } from '/uses/engine/dist/names.js';
const seen = { host: 0, pack: 0, late: 0 };
let hostPort, packPort;
self.addEventListener('message', (e) => {
  if (e.data?.ewHost === 1 && e.ports[0]) (seen.host++, (hostPort = e.ports[0]));
  else if (e.data?.npPort === 1 && e.ports[0]) (seen.pack++, (packPort = e.ports[0]));
  else if (e.data?.late === 1) seen.late++;
});
const engine = await import('/uses/engine/dist/engine.js');
setTimeout(() => {
  const reply = { label, seen, sum: engine.add(2, 3), origin: self.origin };
  hostPort?.postMessage(reply);
  packPort?.postMessage(reply);
}, 100);
`;
const NAMES_JS = `export const label = 'engine';`;
const ENGINE_JS = `
const { instance } = await WebAssembly.instantiateStreaming(fetch(new URL('./add.wasm', import.meta.url)));
export const add = instance.exports.add;
`;

const PARENT_HTML = (frameSrc) => `<!doctype html><meta charset="utf-8"><title>parent</title>
<iframe sandbox="allow-scripts" src="${frameSrc}"></iframe>
<script>
const result = { steps: [] };
const iframe = document.querySelector('iframe');
const done = () => { window.__result = result; };
setTimeout(() => { result.timeout = true; done(); }, 6000);
window.addEventListener('message', (e) => {
  if (e.source !== iframe.contentWindow || e.data?.check !== 1) return;
  result.steps.push(e.data.step);
  if (e.data.step === 'frame') result.frameOrigin = e.data.origin;
  if (e.data.step === 'pack-reply') { result.pack = e.data.reply; if (result.host) done(); }
  if (e.data.step === 'error' || e.data.step === 'construct-threw') { result.error = e.data.message || e.data.step; done(); }
});
iframe.addEventListener('load', () => {
  const host = new MessageChannel();
  host.port1.onmessage = (m) => { result.host = m.data; if (result.pack) done(); };
  iframe.contentWindow.postMessage({ ewHost: 1 }, '*', [host.port2]);
});
</script>`;

const later = (ms) => new Promise((r) => setTimeout(r, ms));

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const frameServer = await listen(async (req, res) => {
  const origin = `http://127.0.0.1:${frameServer.address().port}`;
  const path = new URL(req.url, origin).pathname;
  const files = {
    '/frame.html': ['text/html; charset=utf-8', FRAME_HTML],
    '/frame.js': ['text/javascript', FRAME_JS],
    '/start-core.js': ['text/javascript', START_CORE],
    '/core.js': ['text/javascript', CORE_JS],
    '/uses/engine/dist/names.js': ['text/javascript', NAMES_JS, STATIC_DELAY_MS],
    '/uses/engine/dist/engine.js': ['text/javascript', ENGINE_JS, DYNAMIC_DELAY_MS],
    '/uses/engine/dist/add.wasm': ['application/wasm', ADD_WASM],
  };
  const headers = { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff' };
  const file = files[path];
  if (!file) return res.writeHead(404, headers).end();
  if (file[2]) await later(file[2]);
  res.writeHead(200, { ...headers, 'Content-Type': file[0], 'Content-Security-Policy': csp(origin), 'Cache-Control': 'no-cache' }).end(file[1]);
});
const framePort = frameServer.address().port;
const parentServer = await listen((req, res) => {
  const q = new URL(req.url, 'http://127.0.0.1').searchParams;
  const src = `http://127.0.0.1:${framePort}/frame.html?form=${encodeURIComponent(q.get('form') ?? 'classic')}&core=${encodeURIComponent(q.get('core') ?? './core.js')}`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PARENT_HTML(src));
});
const parentPort = parentServer.address().port;

const CASES = [
  { name: 'startCore, a core that loads', form: 'classic', core: './core.js', expect: 'runs' },
  { name: 'startCore, a core that does not load', form: 'classic', core: './missing.js', expect: 'error' },
  { name: 'module bootstrap of 0.3.2 (for comparison)', form: 'module', core: './core.js', expect: null },
];

function verdict(r) {
  if (r.error) return { ran: false, line: `error event (${r.error})` };
  if (r.timeout && !r.host && !r.pack) return { ran: false, line: `nothing within 6 s (steps: ${r.steps.join(', ') || 'none'})` };
  const ok = (m) => m && m.seen.host === 1 && m.seen.pack === 1 && m.seen.late === 1 && m.sum === 5 && m.origin === 'null' && m.label === 'engine';
  if (ok(r.host) && ok(r.pack)) return { ran: true, line: 'both handoffs and their ports arrived once each, the late message once, WebAssembly 2 + 3 = 5, worker origin null' };
  return { ran: true, line: `ran with differences: host ${JSON.stringify(r.host)}, pack ${JSON.stringify(r.pack)}` };
}

const engines = { chromium, webkit, firefox };
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(engines);
let failed = false;
for (const name of wanted) {
  const browser = await engines[name].launch();
  console.log(`\n${name} ${browser.version()}`);
  for (const c of CASES) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${parentPort}/?form=${c.form}&core=${encodeURIComponent(c.core)}`);
    await page.waitForFunction(() => window.__result, null, { timeout: 15_000 });
    const r = await page.evaluate(() => window.__result);
    await page.close();
    const v = verdict(r);
    const pass = c.expect === null ? null : c.expect === 'runs' ? v.ran && v.line.startsWith('both') : !v.ran && !!r.error;
    if (pass === false) failed = true;
    console.log(`  ${pass === null ? 'info' : pass ? 'pass' : 'FAIL'}  ${c.name}: ${v.line}${r.frameOrigin !== 'null' ? ` (frame origin ${r.frameOrigin})` : ''}`);
  }
  await browser.close();
}
parentServer.close();
frameServer.close();
process.exit(failed ? 1 : 0);
