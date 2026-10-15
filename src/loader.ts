/**
 * The folder's side of the contract. A folder's core imports this, calls
 * `connect()`, and talks to its host through the returned object: in the App's
 * frame over the MessagePort the App hands the page and the page hands the core's
 * worker (`framePort`, `workerPort`), and elsewhere over any transport (the hidden
 * runner, a server). The same core runs in every place (the wave 2 design, D4).
 */
import { FolderMessage, HostMessage, PROTOCOL_VERSION, type ModelRequestIn, type SaveReason, type SavedFile } from './protocol.js';
import type { Transport } from './bridge.js';

type Grant = Extract<HostMessage, { type: 'grant' }>;
type HostRequestType = 'pause' | 'resume' | 'state.read' | 'state.query' | 'state.explain' | 'change.forecast' | 'change.propose' | 'change.apply' | 'change.undo' | 'layout.set' | 'layout.reset';
type HostEventType = 'corner' | 'display' | 'advance' | 'input' | 'save.request';
type HostOf<T extends HostMessage['type']> = Extract<HostMessage, { type: T }>;

export interface Host {
  readonly grant: Grant;
  on<T extends HostEventType>(type: T, listener: (m: HostOf<T>) => void): () => void;
  /** Answers the host's requests; the handler's result is the reply. */
  handle<T extends HostRequestType>(type: T, handler: (m: HostOf<T>) => unknown | Promise<unknown>): void;
  progress(fraction: number, text?: string): void;
  status(line: string): void;
  /** A save for a reason: the complete tree, bytes for what changed. Resolves with `{ version, seq, at }`. */
  save(reason: SaveReason, files: SavedFile[], name?: string): Promise<unknown>;
  /** A model call; `onPart` receives streamed paragraphs when the request asks for them. Returns the call's id beside the promise so it can be cancelled. */
  model(job: string, request: ModelRequestIn, onPart?: (index: number, text: string) => void): { id: number; reply: Promise<unknown> };
  cancel(id: number): void;
  event(level: 'minor' | 'notable' | 'major', text: string): void;
  agent(text: string): Promise<unknown>;
  decide(decision: string, choice: string): Promise<unknown>;
  meter(counts: Record<string, number>): void;
  /** One of the folder's own files at the version started from, as base64. */
  read(path: string): Promise<string>;
  /** A file the person picks; resolves with `{ name, mime, data }`, rejects when they cancel. */
  pick(accept: string[]): Promise<{ name: string; mime: string; data: string }>;
  exportFile(name: string, mime: string, data: string): Promise<unknown>;
  /** Asks the App to open one of its own surfaces over the frame (no reply). */
  open(what: 'saves' | 'copy' | 'rate' | 'start-from', detail?: string): void;
  /** The person's preferences for this folder, kept per account. */
  prefs(prefs: unknown): Promise<unknown>;
  error(message: string): void;
}

const isHandoff = (data: unknown): data is { ewHost: 1 } => (data as { ewHost?: unknown })?.ewHost === PROTOCOL_VERSION;

/**
 * Starts a folder's core as a module worker from a page in the App's frame. A sandboxed page has an
 * opaque origin and cannot start a worker from its own URL, so the worker is a `blob:` bootstrap
 * that imports the core by its absolute URL (the frame's policy allows `blob:` workers; the App's
 * request 4, 2026-10-15). Pass the core's URL, absolute or relative to the page.
 */
export function startCore(url: string): Worker {
  const absolute = new URL(url, location.href).href;
  const bootstrap = URL.createObjectURL(new Blob([`import ${JSON.stringify(absolute)};`], { type: 'text/javascript' }));
  return new Worker(bootstrap, { type: 'module' });
}

/** Waits for the App to hand this frame its port (a window message whose `ewHost` is 1, from the parent only). */
export function framePort(timeoutMs = 10_000): Promise<MessagePort> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => (window.removeEventListener('message', h), reject(new Error('no host handed this frame a port'))), timeoutMs);
    function h(e: MessageEvent) {
      if (e.source !== window.parent || !isHandoff(e.data) || !e.ports[0]) return;
      clearTimeout(timer);
      window.removeEventListener('message', h);
      resolve(e.ports[0]);
    }
    window.addEventListener('message', h);
  });
}

/** Waits for the page to hand this worker the host's port (the same handoff, transferred into the worker). */
export function workerPort(timeoutMs = 10_000): Promise<MessagePort> {
  return new Promise((resolve, reject) => {
    const scope = self as unknown as { addEventListener: Window['addEventListener']; removeEventListener: Window['removeEventListener'] };
    const timer = setTimeout(() => (scope.removeEventListener('message', h as EventListener), reject(new Error('no page handed this worker the host port'))), timeoutMs);
    function h(e: MessageEvent) {
      if (!isHandoff(e.data) || !e.ports[0]) return;
      clearTimeout(timer);
      scope.removeEventListener('message', h as EventListener);
      resolve(e.ports[0]);
    }
    scope.addEventListener('message', h as EventListener);
  });
}

/** Hands a host port on to a worker (the page's side of `workerPort`). */
export function handPort(worker: { postMessage(message: unknown, transfer: Transferable[]): void }, port: MessagePort): void {
  worker.postMessage({ ewHost: PROTOCOL_VERSION }, [port]);
}

/** Connects over a transport; resolves once the host's grant arrives. */
export function connect(transport: Transport, timeoutMs = 10_000): Promise<Host> {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; onPart?: (index: number, text: string) => void }>();
  const listeners = new Map<string, Set<(m: never) => void>>();
  const handlers = new Map<string, (m: never) => unknown>();
  const send = (m: Record<string, unknown>) => {
    const full = { ew: PROTOCOL_VERSION, ...m };
    const parsed = FolderMessage.safeParse(full);
    if (!parsed.success) throw new Error(`invalid folder message ${String(m.type)}: ${parsed.error.message}`);
    transport.send(parsed.data);
  };
  const request = (m: Record<string, unknown>, onPart?: (index: number, text: string) => void) => {
    const id = nextId++;
    const reply = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject, onPart });
      try {
        send({ ...m, id });
      } catch (e) {
        pending.delete(id);
        reject(e as Error);
      }
    });
    return { id, reply };
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the host sent no grant')), timeoutMs);
    let host: Host | undefined;
    transport.onMessage(async (raw) => {
      const parsed = HostMessage.safeParse(raw);
      if (!parsed.success) return;
      const m = parsed.data;
      if (m.type === 'grant') {
        clearTimeout(timer);
        host = makeHost(m);
        return resolve(host);
      }
      if (m.type === 'model.part') {
        pending.get(m.reply_to)?.onPart?.(m.index, m.text);
        return;
      }
      if (m.type === 'reply') {
        const p = pending.get(m.reply_to);
        if (!p) return;
        pending.delete(m.reply_to);
        return m.ok ? p.resolve(m.result) : p.reject(new Error(m.error ?? 'the host refused'));
      }
      if ('id' in m) {
        const h = handlers.get(m.type);
        if (!h) return transport.send({ ew: PROTOCOL_VERSION, type: 'reply', reply_to: m.id, ok: false, error: `${m.type} is not handled by this folder` });
        try {
          const result = await h(m as never);
          transport.send({ ew: PROTOCOL_VERSION, type: 'reply', reply_to: m.id, ok: true, result });
        } catch (e) {
          transport.send({ ew: PROTOCOL_VERSION, type: 'reply', reply_to: m.id, ok: false, error: (e as Error).message });
        }
        return;
      }
      for (const l of listeners.get(m.type) ?? []) l(m as never);
    });
    send({ type: 'ready', protocol: PROTOCOL_VERSION });
  });

  function makeHost(grant: Grant): Host {
    return {
      grant,
      on(type, listener) {
        const set = listeners.get(type) ?? new Set();
        set.add(listener as (m: never) => void);
        listeners.set(type, set);
        return () => set.delete(listener as (m: never) => void);
      },
      handle(type, handler) {
        handlers.set(type, handler as (m: never) => unknown);
      },
      progress: (fraction, text) => send({ type: 'progress', fraction, ...(text === undefined ? {} : { text }) }),
      status: (line) => send({ type: 'status', line }),
      save: (reason, files, name) => request({ type: 'save', reason, files, ...(name === undefined ? {} : { name }) }).reply,
      model: (job, req, onPart) => request({ type: 'model.call', job, request: req }, onPart),
      cancel: (id) => send({ type: 'cancel', id }),
      event: (level, text) => send({ type: 'event', level, text }),
      agent: (text) => request({ type: 'agent.ask', text }).reply,
      decide: (decision, choice) => request({ type: 'agent.decide', decision, choice }).reply,
      meter: (counts) => send({ type: 'meter', counts }),
      read: async (path) => (await request({ type: 'file.read', path }).reply as { data: string }).data,
      pick: (accept) => request({ type: 'file.pick', accept }).reply as Promise<{ name: string; mime: string; data: string }>,
      exportFile: (name, mime, data) => request({ type: 'file.export', name, mime, data }).reply,
      open: (what, detail) => send({ type: 'app.open', what, ...(detail === undefined ? {} : { detail }) }),
      prefs: (prefs) => request({ type: 'prefs.set', prefs }).reply,
      error: (message) => send({ type: 'error', message }),
    };
  }
}
