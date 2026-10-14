/**
 * The folder's side of the contract. A folder's entry imports this, calls
 * `connect()`, and talks to its host through the returned object: in the App's
 * frame over the MessagePort the App hands it, and elsewhere over any transport.
 */
import { FolderMessage, HostMessage, PROTOCOL_VERSION } from './protocol.js';
import type { Transport } from './bridge.js';

type Grant = Extract<HostMessage, { type: 'grant' }>;
type HostRequestType = 'save.request' | 'state.read' | 'state.query' | 'state.explain' | 'change.propose' | 'change.apply' | 'change.undo';
type HostEventType = 'pause' | 'resume' | 'corner' | 'display' | 'advance' | 'input';
type HostOf<T extends HostMessage['type']> = Extract<HostMessage, { type: T }>;

export interface Host {
  readonly grant: Grant;
  on<T extends HostEventType>(type: T, listener: (m: HostOf<T>) => void): () => void;
  /** Answers the host's requests; the handler's result is the reply. */
  handle<T extends HostRequestType>(type: T, handler: (m: HostOf<T>) => unknown | Promise<unknown>): void;
  status(line: string): void;
  save(files: { path: string; sha256: string; data?: string }[]): Promise<unknown>;
  model(job: string, request: Extract<FolderMessage, { type: 'model.call' }>['request']): Promise<unknown>;
  event(level: 'minor' | 'notable' | 'major', text: string): void;
  agent(text: string): Promise<unknown>;
  meter(counts: Record<string, number>): void;
  exportFile(name: string, mime: string, data: string): Promise<unknown>;
  error(message: string): void;
}

/** Waits for the App to hand this frame its port (a window message whose `ewHost` is 1, from the parent only). */
export function framePort(timeoutMs = 10_000): Promise<MessagePort> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => (window.removeEventListener('message', h), reject(new Error('no host handed this frame a port'))), timeoutMs);
    function h(e: MessageEvent) {
      if (e.source !== window.parent || (e.data as { ewHost?: unknown })?.ewHost !== PROTOCOL_VERSION || !e.ports[0]) return;
      clearTimeout(timer);
      window.removeEventListener('message', h);
      resolve(e.ports[0]);
    }
    window.addEventListener('message', h);
  });
}

/** Connects over a transport; resolves once the host's grant arrives. */
export function connect(transport: Transport, timeoutMs = 10_000): Promise<Host> {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listeners = new Map<string, Set<(m: never) => void>>();
  const handlers = new Map<string, (m: never) => unknown>();
  const send = (m: Record<string, unknown>) => {
    const full = { ew: PROTOCOL_VERSION, ...m };
    const parsed = FolderMessage.safeParse(full);
    if (!parsed.success) throw new Error(`invalid folder message ${String(m.type)}: ${parsed.error.message}`);
    transport.send(parsed.data);
  };
  const request = (m: Record<string, unknown>) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ ...m, id });
    });

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
      status: (line) => send({ type: 'status', line }),
      save: (files) => request({ type: 'save', files }),
      model: (job, req) => request({ type: 'model.call', job, request: req }),
      event: (level, text) => send({ type: 'event', level, text }),
      agent: (text) => request({ type: 'agent.ask', text }),
      meter: (counts) => send({ type: 'meter', counts }),
      exportFile: (name, mime, data) => request({ type: 'file.export', name, mime, data }),
      error: (message) => send({ type: 'error', message }),
    };
  }
}
