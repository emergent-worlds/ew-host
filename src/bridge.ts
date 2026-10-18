import type {ComponentFailure} from './component-selection.js';
/**
 * The host's side of the contract: one bridge per running folder, over any
 * transport that carries JSON both ways (a MessagePort in the frame, a loopback
 * socket for the SDK, a WebSocket to a server). It validates every message,
 * refuses any message for an ask the manifest does not make, and correlates
 * requests with their replies.
 */
import { FolderMessage, HostMessage, PROTOCOL_VERSION, deliverable, permitted, type HostMessageIn, type SaveReason } from './protocol.js';
import type { Asks } from './manifest.js';
import { refusalError, refusalFields } from './refusal.js';
import { endpointReceives, endpointSends, type EndpointFamily } from './endpoints.js';

/** The minimum a transport offers. */
export interface Transport {
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  /** Socket or worker adapters report disposal so both sides reject outstanding requests. */
  onClose?(listener: (error: Error) => void): () => void;
  close(): void;
}

/** A MessagePort as a transport (the App's frame, a worker). */
export function portTransport(port: MessagePort): Transport {
  return {
    send: (m) => port.postMessage(m),
    onMessage: (listener) => {
      const h = (e: MessageEvent) => listener(e.data);
      port.addEventListener('message', h);
      port.start();
      return () => port.removeEventListener('message', h);
    },
    close: () => port.close(),
  };
}

type DOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type HostOut = DOmit<HostMessageIn, 'ew'>;
type HostRequest = Extract<HostOut, { id: number }>;
type FolderOf<T extends FolderMessage['type']> = Extract<FolderMessage, { type: T }>;

/** What the host does with each kind of folder message. Requests resolve to a reply's result. */
export interface HostHandlers {
  ready?(): void;
  /** Called only on the private core endpoint, within its actual host operation gate. */
  transactionObserve?(m: FolderOf<'transaction.observe'>): Promise<unknown>;
  progress?(fraction: number, text?: string): void;
  status?(line: string): void;
  /** Commits the save as a version; resolves `{ version, seq, at }`. */
  save?(m: FolderOf<'save'>): Promise<unknown>;
  /** Routes the call; `part` releases a streamed paragraph to the folder before the reply. `signal` is aborted by a `cancel`. */
  modelCall?(m: FolderOf<'model.call'>, part: (index: number, text: string) => void, signal: AbortSignal): Promise<unknown>;
  event?(m: FolderOf<'event'>): void;
  agentAsk?(m: FolderOf<'agent.ask'>): Promise<unknown>;
  agentDecide?(m: FolderOf<'agent.decide'>): Promise<unknown>;
  meter?(counts: Record<string, number>): void;
  /** Resolves `{ data }`, base64, for a path of the folder's tree at the version started from. */
  fileRead?(path: string): Promise<unknown>;
  filePick?(accept: string[]): Promise<unknown>;
  fileExport?(m: FolderOf<'file.export'>): Promise<unknown>;
  prefsSet?(prefs: unknown): Promise<unknown>;
  /** The folder asks the App to open one of its own surfaces over the frame (no reply). */
  appOpen?(what: FolderOf<'app.open'>['what'], detail?: string): void;
  error?(message: string): void;
  componentFailed?(failure:ComponentFailure):void;
  /** A message refused or malformed; the bridge has already answered the folder. */
  refused?(reason: string, raw: unknown): void;
}

export class HostBridge {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private cancels = new Map<number, AbortController>();
  private saveWaiters: { reason: SaveReason; resolve: (v: unknown) => void; reject: (e: Error) => void }[] = [];
  private savingWaiters: { reason: SaveReason; resolve: (v: unknown) => void; reject: (e: Error) => void }[] = [];
  private unsubscribe: () => void;
  private unsubscribeClose: (() => void) | undefined;
  private closed = false;

  constructor(
    private readonly transport: Transport,
    private readonly asks: Asks,
    private readonly handlers: HostHandlers,
    private readonly timeoutMs = 30_000,
    private readonly family: EndpointFamily = 'combined',
  ) {
    this.unsubscribe = transport.onMessage((raw) => void this.receive(raw));
    this.unsubscribeClose = transport.onClose?.((error) => this.dispose(error));
  }

  /** Sends a host message that needs no answer, if the grant allows it. Returns whether it was sent. */
  send(message: Exclude<HostOut, HostRequest>): boolean {
    if (this.closed) return false;
    const full = { ew: PROTOCOL_VERSION, ...message, ...(message.type === 'grant' ? { endpoint: this.family } : {}) } as HostMessage;
    const parsed = HostMessage.safeParse(full);
    if (!parsed.success) throw new Error(`invalid host message ${message.type}: ${parsed.error.message}`);
    if (!endpointReceives(this.family, parsed.data.type) || !deliverable(parsed.data, this.asks)) return false;
    this.transport.send(parsed.data);
    return true;
  }

  /** Sends a request to the folder (pause, resume, state.*, change.*, layout.*) and waits for its reply. */
  request(message: DOmit<HostRequest, 'id'>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('the folder closed'));
    const id = this.nextId++;
    const full = { ew: PROTOCOL_VERSION, id, ...message } as HostMessage;
    const parsed = HostMessage.safeParse(full);
    if (!parsed.success) return Promise.reject(new Error(`invalid host request: ${parsed.error.message}`));
    if (!endpointReceives(this.family, parsed.data.type) || !deliverable(parsed.data, this.asks)) return Promise.reject(new Error(`${message.type} is not granted to this folder`));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${message.type} got no reply in ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      try {
        this.transport.send(parsed.data);
      } catch (error) {
        const waiter = this.pending.get(id);
        this.pending.delete(id);
        waiter?.reject(error instanceof Error ? error : new Error('transport send failed'));
      }
    });
  }

  /**
   * Asks the folder to save for a reason and resolves with the committed version
   * (what the `save` handler returned) once the folder's `save` for that reason
   * has been handled; rejects after the bridge's ceiling.
   */
  requestSave(reason: SaveReason, name?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const waiter = {
        reason,
        resolve: (v: unknown) => (clearTimeout(timer), resolve(v)),
        reject: (e: Error) => (clearTimeout(timer), reject(e)),
      };
      const timer = setTimeout(() => {
        this.saveWaiters = this.saveWaiters.filter((w) => w !== waiter);
        this.savingWaiters = this.savingWaiters.filter((w) => w !== waiter);
        reject(new Error(`the folder made no save for ${reason} in ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      // A transport may deliver synchronously. Observe the save before asking for it.
      this.saveWaiters.push(waiter);
      try {
        if (!this.send({ type: 'save.request', reason, ...(name === undefined ? {} : { name }) })) throw new Error('save.request is not granted to this folder');
      } catch (e) {
        this.saveWaiters = this.saveWaiters.filter((w) => w !== waiter);
        waiter.reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  close(): void {
    this.dispose(new Error('the folder closed'));
  }

  private dispose(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.unsubscribeClose?.();
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
    for (const w of this.saveWaiters) w.reject(error);
    this.saveWaiters = [];
    for (const w of this.savingWaiters) w.reject(error);
    this.savingWaiters = [];
    for (const c of this.cancels.values()) c.abort();
    this.cancels.clear();
    this.transport.close();
  }

  private reply(replyTo: number, ok: boolean, result?: unknown, error?: unknown): void {
    if (this.closed) return;
    this.transport.send({ ew: PROTOCOL_VERSION, type: 'reply', reply_to: replyTo, ok, ...(ok ? { result } : refusalFields(error)) });
  }

  private async receive(raw: unknown): Promise<void> {
    if (this.closed) return;
    const parsed = FolderMessage.safeParse(raw);
    if (!parsed.success) {
      const id = typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'number' ? (raw as { id: number }).id : undefined;
      if (id !== undefined) this.reply(id, false, undefined, 'malformed message');
      this.handlers.refused?.('malformed message', raw);
      return;
    }
    const m = parsed.data;
    const allowed = endpointSends(this.family, m.type) ? permitted(m, this.asks) : { ok: false as const, reason: `${m.type} is not allowed on the ${this.family} endpoint` };
    if (!allowed.ok) {
      if ('id' in m) this.reply(m.id, false, undefined, allowed.reason);
      this.handlers.refused?.(allowed.reason, raw);
      return;
    }
    const answer = async (id: number, work: (() => Promise<unknown>) | undefined) => {
      if (!work) return this.reply(id, false, undefined, `${m.type} is not handled by this host`);
      try {
        this.reply(id, true, await work());
      } catch (e) {
        this.reply(id, false, undefined, e);
      }
    };
    switch (m.type) {
      case 'ready':
        return this.handlers.ready?.();
      case 'progress':
        return this.handlers.progress?.(m.fraction, m.text);
      case 'app.open':
        return this.handlers.appOpen?.(m.what, m.detail);
      case 'status':
        return this.handlers.status?.(m.line);
      case 'save': {
        const waiters = this.saveWaiters.filter((w) => w.reason === m.reason);
        this.saveWaiters = this.saveWaiters.filter((w) => w.reason !== m.reason);
        if (!this.handlers.save) {
          for (const w of waiters) w.reject(new Error('save is not handled by this host'));
          return answer(m.id, undefined);
        }
        this.savingWaiters.push(...waiters);
        try {
          const result = await this.handlers.save(m);
          this.reply(m.id, true, result);
          for (const w of waiters) w.resolve(result);
        } catch (e) {
          this.reply(m.id, false, undefined, e);
          for (const w of waiters) w.reject(e as Error);
        } finally {
          this.savingWaiters = this.savingWaiters.filter((w) => !waiters.includes(w));
        }
        return;
      }
      case 'model.call': {
        if (!this.handlers.modelCall) return answer(m.id, undefined);
        const controller = new AbortController();
        this.cancels.set(m.id, controller);
        const part = (index: number, text: string) => { if (!this.closed) this.transport.send({ ew: PROTOCOL_VERSION, type: 'model.part', reply_to: m.id, index, text }); };
        try {
          this.reply(m.id, true, await this.handlers.modelCall(m, part, controller.signal));
        } catch (e) {
          this.reply(m.id, false, undefined, controller.signal.aborted ? 'cancelled' : e);
        } finally {
          this.cancels.delete(m.id);
        }
        return;
      }
      case 'cancel':
        return this.cancels.get(m.id)?.abort();
      case 'event':
        return this.handlers.event?.(m);
      case 'transaction.observe':
        return answer(m.id, this.handlers.transactionObserve && (() => this.handlers.transactionObserve!(m)));
      case 'agent.ask':
        return answer(m.id, this.handlers.agentAsk && (() => this.handlers.agentAsk!(m)));
      case 'agent.decide':
        return answer(m.id, this.handlers.agentDecide && (() => this.handlers.agentDecide!(m)));
      case 'meter':
        return this.handlers.meter?.(m.counts);
      case 'file.read':
        return answer(m.id, this.handlers.fileRead && (() => this.handlers.fileRead!(m.path)));
      case 'file.pick':
        return answer(m.id, this.handlers.filePick && (() => this.handlers.filePick!(m.accept)));
      case 'file.export':
        return answer(m.id, this.handlers.fileExport && (() => this.handlers.fileExport!(m)));
      case 'prefs.set':
        return answer(m.id, this.handlers.prefsSet && (() => this.handlers.prefsSet!(m.prefs)));
      case 'component.failed':return this.handlers.componentFailed?.(m.failure);
      case 'error':
        return this.handlers.error?.(m.message);
      case 'reply': {
        const p = this.pending.get(m.reply_to);
        if (!p) return;
        this.pending.delete(m.reply_to);
        return m.ok ? p.resolve(m.result) : p.reject(refusalError(m, 'the folder refused'));
      }
    }
  }
}
