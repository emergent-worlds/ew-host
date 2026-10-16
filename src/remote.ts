/** E8: a player's page port, with synchronization and stable operation identity. */
import type { PortClient, PortNotice } from './port.js';
import { SOCKET_FRAME_BYTES, type SocketLike } from './loopback.js';
import { encodeRemoteClientFrame, parseRemoteServerFrame, RemotePortCall, type RemoteAdmitted, type RemoteClientFrame, type RemoteServerFrame } from './remote-schema.js';

export type RemoteState = 'connecting' | 'syncing' | 'ready' | 'disconnected' | 'closed';
export type RemoteControl = Exclude<Extract<RemoteServerFrame, { ch: 'ctl' }>, { type: 'admitted' | 'snapshot' | 'sync' | 'ready' }>;
export type RemoteAgentResult = Extract<RemoteServerFrame, { ch: 'agent'; type: 'result' }>;
export interface RemoteRequestOptions { requestId?: string; part?: (text: string) => void }
export interface RemotePortOptions {
  token: string;
  /** Installs an authoritative replacement projection before its exact boundary is acknowledged. */
  installSnapshot(notices: readonly PortNotice[], seq: number, signal: AbortSignal): void | Promise<void>;
  /** A native adapter supplies plain direct sockets; the default web transport uses WSS or local fixtures. */
  socket?: (url: string) => SocketLike;
  signal?: AbortSignal;
  onState?: (state: RemoteState) => void;
  /** Admission credentials are excluded from this public control callback. */
  onControl?: (frame: RemoteControl) => void;
  requestId?: () => string;
}
export interface RemotePort extends PortClient {
  readonly state: RemoteState;
  /** Current connection's synchronization promise; changes after a disconnect. */
  readonly ready: Promise<void>;
  readonly lastSeq: number;
  readonly admission: Readonly<Pick<RemoteAdmitted, 'slotId' | 'sender' | 'epoch'>> | undefined;
  /** A caller may retain an explicit identity for a later retry of the same logical request. */
  call(name: string, args?: unknown, requestId?: string): Promise<unknown>;
  input(kind: Extract<RemoteClientFrame, { ch: 'input' }>['kind'], data: unknown, requestId?: string): Promise<void>;
  ask(text: string, options?: RemoteRequestOptions): Promise<RemoteAgentResult>;
  decide(decision: string, choice: string, options?: RemoteRequestOptions): Promise<RemoteAgentResult>;
  /** Called by the App when connectivity returns. It never reuses a join ticket. */
  reconnect(): Promise<void>;
}
const deferred = () => {
  let resolve!: () => void; let reject!: (error: Error) => void;
  let settled = false;
  const promise = new Promise<void>((yes, no) => { resolve = () => { settled = true; yes(); }; reject = error => { settled = true; no(error); }; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject, get settled() { return settled; } };
};
const stable = (value: unknown) => JSON.stringify(value, (_key, part) => part && typeof part === 'object' && !Array.isArray(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part);
const newId = () => {
  const bytes = new Uint8Array(32); globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
};
interface Operation {
  frame: Extract<RemoteClientFrame, { requestId: string }>;
  identity: string; promise: Promise<any>; resolve: (value: any) => void; reject: (error: Error) => void;
  part?: (text: string) => void;
}

/** Returns the same page PortClient surface as a local core; it grants no server capability. */
export function remotePort(url: string, options: RemotePortOptions): RemotePort {
  let address: URL;
  try { address = new URL(url); } catch { throw new Error('invalid remote address'); }
  const local = address.hostname === '127.0.0.1' || address.hostname === '[::1]' || address.hostname === 'localhost';
  if (!['ws:', 'wss:'].includes(address.protocol) || address.username || address.password || address.search || address.hash || (address.protocol === 'ws:' && !local && !options.socket)) throw new Error('a remote connection requires a clean secure address or native socket adapter');
  // Validate before opening a socket, without placing the token in a URL or diagnostic.
  encodeRemoteClientFrame({ v: 1, ch: 'ctl', type: 'join', token: options.token });
  let phase: RemoteState = 'connecting'; let cycle = deferred();
  let applied = 0; let numericId = 0; let generation = 0;
  let admitted: RemoteAdmitted | undefined; let joinToken: string | undefined = options.token;
  let socket: SocketLike | undefined; let detach = () => {};
  let attemptAbort = new AbortController();
  let refresh: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let disconnectedAt: number | undefined;
  let snapshot = false; let synchronized: number | undefined; let acknowledged = false;
  let admittedThisAttempt = false; let resumeAttempt = false;
  const operations = new Map<string, Operation>();
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const inbox: { frame: RemoteServerFrame; bytes: number; generation: number }[] = [];
  let queuedBytes = 0; let queuedNotices = 0; let largestQueued = 0;
  let draining = false;
  let finishing = false;
  const state = (next: RemoteState) => { phase = next; try { options.onState?.(next); } catch { /* Observation does not authorize or alter the connection. */ } };
  const write = (frame: RemoteClientFrame) => {
    if (!socket || socket.readyState !== 1 || phase === 'closed') throw new Error('the remote connection is unavailable');
    socket.send(encodeRemoteClientFrame(frame));
  };
  function finish(error = new Error('the remote page closed'), leave = false) {
    if (phase === 'closed' || finishing) return;
    finishing = true;
    if (leave && admittedThisAttempt) { try { write({ v: 1, ch: 'ctl', type: 'leave' }); } catch { /* Closure still rejects local waiters. */ } }
    generation++; detach(); attemptAbort.abort(); socket?.close(); socket = undefined;
    clearTimeout(refresh); clearTimeout(expiry); inbox.length = 0; queuedBytes = 0; queuedNotices = 0; largestQueued = 0;
    admitted = undefined; joinToken = undefined;
    if (cycle.settled) cycle = deferred();
    cycle.reject(error);
    for (const operation of operations.values()) operation.reject(error);
    operations.clear(); listeners.clear(); options.signal?.removeEventListener('abort', abort);
    state('closed');
  }
  function disconnected() {
    if (phase === 'closed' || phase === 'disconnected') return;
    if (!admitted) { finish(new Error('remote admission did not complete')); return; }
    generation++; detach(); attemptAbort.abort(); socket?.close(); socket = undefined;
    clearTimeout(refresh);
    if (cycle.settled) cycle = deferred();
    if (disconnectedAt === undefined) {
      disconnectedAt = Date.now();
      expiry = setTimeout(() => finish(new Error('the remote reconnect window expired')), 5 * 60 * 1000);
    }
    state('disconnected');
  }
  const abort = () => finish(new Error('the remote page was cancelled'));
  const acknowledge = (seq: number) => { try { write({ v: 1, ch: 'ctl', type: 'ack', seq }); return true; } catch { disconnected(); return false; } };
  function notify(notice: PortNotice) { for (const listener of listeners.get(notice.notice) ?? []) listener(notice.data); }
  function settle(frame: Extract<RemoteServerFrame, { requestId: string }>) {
    const operation = operations.get(frame.requestId);
    if (!operation) return;
    if (operation.frame.ch !== frame.ch) throw new Error('remote reply channel mismatch');
    if (frame.ch === 'agent' && frame.type === 'part') { operation.part?.(frame.text); return; }
    if (frame.ch === 'port') {
      if (operation.frame.ch !== 'port' || frame.body.reply_to !== operation.frame.body.id) throw new Error('remote reply id mismatch');
      operations.delete(frame.requestId);
      frame.body.ok ? operation.resolve(frame.body.result) : operation.reject(new Error('the remote folder refused the call'));
    } else if (frame.ch === 'input') {
      operations.delete(frame.requestId);
      frame.ok ? operation.resolve(undefined) : operation.reject(new Error('the remote host refused the input'));
    } else {
      operations.delete(frame.requestId);
      frame.ok ? operation.resolve(frame) : operation.reject(new Error('the remote host refused the agent request'));
    }
  }
  async function receive(frame: RemoteServerFrame, atGeneration: number) {
    if (phase === 'closed' || atGeneration !== generation) return;
    if (frame.ch === 'ctl') {
      if (frame.type === 'admitted') {
        if (admittedThisAttempt || (admitted && (admitted.slotId !== frame.slotId || admitted.epoch !== frame.epoch || admitted.sender !== frame.sender))) throw new Error('remote admission changed its slot or epoch');
        admitted = frame; joinToken = undefined; admittedThisAttempt = true; state('syncing'); return;
      }
      if (!admittedThisAttempt) {
        if (frame.type === 'error' || frame.type === 'ending') { options.onControl?.(frame); finish(new Error('remote admission was refused')); return; }
        throw new Error('remote traffic preceded admission');
      }
      if (frame.type === 'snapshot') {
        if (acknowledged || snapshot || synchronized !== undefined || frame.seq < applied) throw new Error('invalid remote snapshot boundary');
        const signal = attemptAbort.signal;
        let cancel!: () => void;
        const cancelled = new Promise<never>((_resolve, reject) => { cancel = () => reject(new Error('the snapshot attempt was replaced')); signal.addEventListener('abort', cancel, { once: true }); });
        try {
          if (signal.aborted) cancel();
          await Promise.race([options.installSnapshot(frame.notices, frame.seq, signal), cancelled]);
        } finally { signal.removeEventListener('abort', cancel); }
        if (atGeneration !== generation) return;
        applied = frame.seq; snapshot = true; return;
      }
      if (frame.type === 'sync') {
        if (synchronized !== undefined || frame.seq !== applied || (frame.mode === 'snapshot') !== snapshot || (!resumeAttempt && !snapshot)) throw new Error('invalid remote synchronization boundary');
        synchronized = frame.seq;
        acknowledged = acknowledge(frame.seq); return;
      }
      if (frame.type === 'ready') {
        if (!acknowledged || phase === 'ready' || frame.seq !== applied) throw new Error('invalid remote ready boundary');
        clearTimeout(expiry); disconnectedAt = undefined; state('ready');
        if (atGeneration !== generation) return;
        if (applied !== synchronized && !acknowledge(applied)) return;
        try { for (const operation of operations.values()) write(operation.frame); } catch { disconnected(); return; }
        refresh = setTimeout(() => { void reconnect().catch(() => undefined); }, 55 * 60 * 1000);
        cycle.resolve(); return;
      }
      options.onControl?.(frame);
      if (frame.type === 'ending') finish(new Error('the remote session ended'));
      return;
    }
    if (!admittedThisAttempt) throw new Error('remote traffic preceded admission');
    if (frame.ch === 'port' && 'seq' in frame) {
      if (!resumeAttempt && !snapshot) throw new Error('remote notices preceded the initial snapshot');
      if (frame.seq <= applied) { if (phase === 'ready') acknowledge(applied); return; }
      if (frame.seq !== applied + 1) { disconnected(); return; }
      notify(frame.body); applied = frame.seq;
      if (phase === 'ready') acknowledge(applied);
      return;
    }
    if (phase !== 'ready') throw new Error('remote reply preceded readiness');
    settle(frame);
  }
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (inbox.length && phase !== 'closed') {
        const next = inbox.shift()!;
        queuedBytes -= next.bytes;
        if (next.frame.ch === 'port' && 'seq' in next.frame) queuedNotices--;
        if (!inbox.length) largestQueued = 0;
        if (next.generation !== generation) continue;
        try { await receive(next.frame, next.generation); }
        catch { if (next.generation === generation) finish(new Error('the remote protocol or page synchronization failed')); }
      }
    } finally { draining = false; }
  }
  function open() {
    const thisGeneration = ++generation;
    detach(); attemptAbort.abort(); socket?.close();
    attemptAbort = new AbortController();
    resumeAttempt = Boolean(admitted);
    snapshot = false; synchronized = undefined; acknowledged = false; admittedThisAttempt = false;
    state('connecting');
    if (phase === 'closed') return;
    let candidate: SocketLike;
    try { candidate = options.socket ? options.socket(address.href) : new WebSocket(address.href); }
    catch { disconnected(); return; }
    socket = candidate;
    let opened = false;
    const onOpen = () => {
      if (thisGeneration !== generation || opened || phase === 'closed') return;
      opened = true;
      try {
        if (admitted) write({ v: 1, ch: 'ctl', type: 'resume', credential: admitted.resume, lastSeq: applied });
        else if (joinToken) write({ v: 1, ch: 'ctl', type: 'join', token: joinToken });
        else finish(new Error('remote admission cannot be reused'));
      } catch { disconnected(); }
    };
    const onMessage = (event: { data: unknown }) => {
      if (thisGeneration !== generation || phase === 'closed') return;
      try {
        const frame = parseRemoteServerFrame(event.data);
        const bytes = new TextEncoder().encode(event.data as string).byteLength;
        inbox.push({ frame, bytes, generation: thisGeneration });
        queuedBytes += bytes; largestQueued = Math.max(largestQueued, bytes);
        if (frame.ch === 'port' && 'seq' in frame) queuedNotices++;
        // One wire frame plus PV85's replay budget may wait for an asynchronous snapshot installer.
        if (queuedBytes - largestQueued > SOCKET_FRAME_BYTES || queuedNotices > 1000) throw new Error();
        void drain();
      } catch { finish(new Error('the remote host sent an invalid or excessive frame')); }
    };
    const lost = () => { if (thisGeneration === generation) disconnected(); };
    candidate.addEventListener('open', onOpen); candidate.addEventListener('message', onMessage);
    candidate.addEventListener('error', lost); candidate.addEventListener('close', lost);
    detach = () => {
      candidate.removeEventListener('open', onOpen); candidate.removeEventListener('message', onMessage);
      candidate.removeEventListener('error', lost); candidate.removeEventListener('close', lost);
    };
    if (candidate.readyState === 1) onOpen();
  }
  function reconnect(): Promise<void> {
    if (phase === 'closed') return Promise.reject(new Error('the remote page closed'));
    if (phase === 'connecting' || phase === 'syncing') return cycle.promise;
    if (!admitted) return Promise.reject(new Error('remote admission did not complete'));
    if (phase === 'ready') disconnected();
    if (phase === 'disconnected') open();
    return cycle.promise;
  }
  function request(frame: Extract<RemoteClientFrame, { requestId: string }>, part?: (text: string) => void): Promise<any> {
    if (phase !== 'ready') return Promise.reject(new Error('the remote page is not synchronized'));
    let encoded: string;
    try { encoded = encodeRemoteClientFrame(frame); } catch { return Promise.reject(new Error('invalid remote request')); }
    const safe = JSON.parse(encoded) as typeof frame;
    const identity = stable(safe.ch === 'port' ? { ch: safe.ch, call: safe.body.call, args: safe.body.args } : { ...safe, requestId: undefined });
    const previous = operations.get(safe.requestId);
    if (previous) return previous.identity === identity ? previous.promise : Promise.reject(new Error('a remote request id was reused for a different operation'));
    let resolve!: (value: any) => void; let reject!: (error: Error) => void;
    const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
    operations.set(safe.requestId, { frame: safe, identity, promise, resolve, reject, part });
    try { write(safe); } catch { disconnected(); }
    return promise;
  }
  const id = (explicit?: string) => explicit ?? options.requestId?.() ?? newId();
  const client: RemotePort = {
    get state() { return phase; }, get ready() { return cycle.promise; }, get lastSeq() { return applied; },
    get admission() { return admitted ? { slotId: admitted.slotId, sender: admitted.sender, epoch: admitted.epoch } : undefined; },
    call(name, args, requestId) {
      if (!Number.isSafeInteger(++numericId)) return Promise.reject(new Error('the remote port id space is exhausted'));
      const body = RemotePortCall.safeParse({ ew: 1, id: numericId, call: name, ...(args === undefined ? {} : { args }) });
      return body.success ? request({ v: 1, ch: 'port', requestId: id(requestId), body: body.data }) : Promise.reject(new Error('invalid remote folder call'));
    },
    on(notice, listener) {
      if (phase === 'closed') throw new Error('the remote page closed');
      const set = listeners.get(notice) ?? new Set(); set.add(listener); listeners.set(notice, set);
      return () => { set.delete(listener); };
    },
    input: (kind, data, requestId) => data === undefined ? Promise.reject(new Error('remote input has data')) : request({ v: 1, ch: 'input', requestId: id(requestId), kind, data }),
    ask: (text, opts = {}) => request({ v: 1, ch: 'agent', requestId: id(opts.requestId), type: 'ask', text }, opts.part),
    decide: (decision, choice, opts = {}) => request({ v: 1, ch: 'agent', requestId: id(opts.requestId), type: 'decide', decision, choice }, opts.part),
    reconnect, close: () => finish(new Error('the remote page closed'), true),
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort(); else open();
  return client;
}
