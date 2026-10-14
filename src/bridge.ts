/**
 * The host's side of the contract: one bridge per running folder, over any
 * transport that carries JSON both ways (a MessagePort in the frame, a loopback
 * socket for the SDK, a WebSocket to a server). It validates every message,
 * refuses any message for an ask the manifest does not make, and correlates
 * requests with their replies.
 */
import { FolderMessage, HostMessage, PROTOCOL_VERSION, deliverable, permitted } from './protocol.js';
import type { Asks } from './manifest.js';

/** The minimum a transport offers. */
export interface Transport {
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  close(): void;
}

/** A MessagePort as a transport (the App's frame). */
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
type HostOut = DOmit<HostMessage, 'ew'>;
type HostRequest = Extract<HostOut, { id: number }>;
type FolderOf<T extends FolderMessage['type']> = Extract<FolderMessage, { type: T }>;

/** What the host does with each kind of folder message. Requests resolve to a reply's result. */
export interface HostHandlers {
  ready?(): void;
  status?(line: string): void;
  save?(m: FolderOf<'save'>): Promise<unknown>;
  modelCall?(m: FolderOf<'model.call'>): Promise<unknown>;
  event?(m: FolderOf<'event'>): void;
  agentAsk?(m: FolderOf<'agent.ask'>): Promise<unknown>;
  meter?(counts: Record<string, number>): void;
  fileExport?(m: FolderOf<'file.export'>): Promise<unknown>;
  error?(message: string): void;
  /** A message refused or malformed; the bridge has already answered the folder. */
  refused?(reason: string, raw: unknown): void;
}

export class HostBridge {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private unsubscribe: () => void;

  constructor(
    private readonly transport: Transport,
    private readonly asks: Asks,
    private readonly handlers: HostHandlers,
    private readonly timeoutMs = 30_000,
  ) {
    this.unsubscribe = transport.onMessage((raw) => void this.receive(raw));
  }

  /** Sends a host message that needs no answer, if the grant allows it. Returns whether it was sent. */
  send(message: Exclude<HostOut, HostRequest>): boolean {
    const full = { ew: PROTOCOL_VERSION, ...message } as HostMessage;
    const parsed = HostMessage.safeParse(full);
    if (!parsed.success) throw new Error(`invalid host message ${message.type}: ${parsed.error.message}`);
    if (!deliverable(parsed.data, this.asks)) return false;
    this.transport.send(parsed.data);
    return true;
  }

  /** Sends a request to the folder (state.*, change.*, save.request) and waits for its reply. */
  request(message: DOmit<HostRequest, 'id'>): Promise<unknown> {
    const id = this.nextId++;
    const full = { ew: PROTOCOL_VERSION, id, ...message } as HostMessage;
    const parsed = HostMessage.safeParse(full);
    if (!parsed.success) return Promise.reject(new Error(`invalid host request: ${parsed.error.message}`));
    if (!deliverable(parsed.data, this.asks)) return Promise.reject(new Error(`${message.type} is not granted to this folder`));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${message.type} got no reply in ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.transport.send(parsed.data);
    });
  }

  close(): void {
    this.unsubscribe();
    for (const p of this.pending.values()) p.reject(new Error('the folder closed'));
    this.pending.clear();
    this.transport.close();
  }

  private reply(replyTo: number, ok: boolean, result?: unknown, error?: string): void {
    this.transport.send({ ew: PROTOCOL_VERSION, type: 'reply', reply_to: replyTo, ok, ...(ok ? { result } : { error }) });
  }

  private async receive(raw: unknown): Promise<void> {
    const parsed = FolderMessage.safeParse(raw);
    if (!parsed.success) {
      const id = typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'number' ? (raw as { id: number }).id : undefined;
      if (id !== undefined) this.reply(id, false, undefined, 'malformed message');
      this.handlers.refused?.('malformed message', raw);
      return;
    }
    const m = parsed.data;
    const allowed = permitted(m, this.asks);
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
        this.reply(id, false, undefined, (e as Error).message);
      }
    };
    switch (m.type) {
      case 'ready':
        return this.handlers.ready?.();
      case 'status':
        return this.handlers.status?.(m.line);
      case 'save':
        return answer(m.id, this.handlers.save && (() => this.handlers.save!(m)));
      case 'model.call':
        return answer(m.id, this.handlers.modelCall && (() => this.handlers.modelCall!(m)));
      case 'event':
        return this.handlers.event?.(m);
      case 'agent.ask':
        return answer(m.id, this.handlers.agentAsk && (() => this.handlers.agentAsk!(m)));
      case 'meter':
        return this.handlers.meter?.(m.counts);
      case 'file.export':
        return answer(m.id, this.handlers.fileExport && (() => this.handlers.fileExport!(m)));
      case 'error':
        return this.handlers.error?.(m.message);
      case 'reply': {
        const p = this.pending.get(m.reply_to);
        if (!p) return;
        this.pending.delete(m.reply_to);
        return m.ok ? p.resolve(m.result) : p.reject(new Error(m.error ?? 'the folder refused'));
      }
    }
  }
}
