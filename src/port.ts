/**
 * A folder's own port: the envelope a folder's page uses to call its core, which
 * runs in a worker in the frame and holds the engine (the plan, Section 3.2; the
 * wave 2 design, D4). The engine's nine calls ride it under their own names
 * (`load`, `save`, `advance`, `input`, `read`, `query`, `explain`, `forecast`,
 * `change`), and a pack adds calls of its own under a prefix it chooses. The host
 * contract never rides this port: it terminates in the core.
 */
import { z } from 'zod';
import type { Transport } from './bridge.js';

export const PORT_VERSION = 1 as const;

export const PortCall = z.object({ ew: z.literal(PORT_VERSION), id: z.number().int().nonnegative(), call: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/), args: z.unknown().optional(), from: z.string().min(1).max(200).optional() });
export const PortNotice = z.object({ ew: z.literal(PORT_VERSION), notice: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/), data: z.unknown().optional() });
export const PortReply = z.object({ ew: z.literal(PORT_VERSION), reply_to: z.number().int(), ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() });
export type PortCall = z.infer<typeof PortCall>;
export type PortNotice = z.infer<typeof PortNotice>;
export type PortReply = z.infer<typeof PortReply>;

export interface PortClient {
  call(name: string, args?: unknown): Promise<unknown>;
  /** Notices the core sends on its own account: an event, a tick, a status line. */
  on(notice: string, listener: (data: unknown) => void): () => void;
  close(): void;
}

/** The page's side: calls into the core and listens for its notices. */
export function callPort(transport: Transport, timeoutMs = 30_000): PortClient {
  let nextId = 1;
  let closed = false;
  let unclose = () => {};
  const close = (error = new Error('the port closed')) => {
    if (closed) return;
    closed = true;
    off(); unclose();
    for (const p of pending.values()) p.reject(error);
    pending.clear(); listeners.clear(); transport.close();
  };
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listeners = new Map<string, Set<(d: unknown) => void>>();
  const off = transport.onMessage((raw) => {
    const reply = PortReply.safeParse(raw);
    if (reply.success) {
      const p = pending.get(reply.data.reply_to);
      if (!p) return;
      pending.delete(reply.data.reply_to);
      return reply.data.ok ? p.resolve(reply.data.result) : p.reject(new Error(reply.data.error ?? 'the core refused'));
    }
    const notice = PortNotice.safeParse(raw);
    if (notice.success) for (const l of listeners.get(notice.data.notice) ?? []) l(notice.data.data);
  });
  unclose = transport.onClose?.(close) ?? (() => {});
  if (closed) unclose();
  return {
    call: (name, args) =>
      new Promise((resolve, reject) => {
        if (closed) { reject(new Error('the port closed')); return; }
        const id = nextId++;
        const timer = setTimeout(() => (pending.delete(id), reject(new Error(`${name} got no reply in ${timeoutMs} ms`))), timeoutMs);
        pending.set(id, { resolve: (v) => (clearTimeout(timer), resolve(v)), reject: (e) => (clearTimeout(timer), reject(e)) });
        const m: PortCall = { ew: PORT_VERSION, id, call: name, ...(args === undefined ? {} : { args }) };
        try { transport.send(m); } catch (error) { pending.get(id)?.reject(error as Error); pending.delete(id); }
      }),
    on(notice, listener) {
      if (closed) throw new Error('the port closed');
      const set = listeners.get(notice) ?? new Set();
      set.add(listener);
      listeners.set(notice, set);
      return () => set.delete(listener);
    },
    close: () => close(),
  };
}

export interface PortServer {
  /** Sends a notice to the page. */
  notify(notice: string, data?: unknown): void;
  close(): void;
}

/** The core's side: answers calls by name; a call with no handler is refused. */
export function servePort(transport: Transport, handlers: Record<string, (args: unknown, from?: string) => unknown | Promise<unknown>>): PortServer {
  let closed = false;
  let unclose = () => {};
  const close = () => { if (closed) return; closed = true; off(); unclose(); transport.close(); };
  const off = transport.onMessage(async (raw) => {
    if (closed) return;
    const call = PortCall.safeParse(raw);
    if (!call.success) return;
    const { id, call: name, args, from } = call.data;
    const reply = (ok: boolean, result?: unknown, error?: string) => {
      if (closed) return;
      try { transport.send({ ew: PORT_VERSION, reply_to: id, ok, ...(ok ? { result } : { error }) } satisfies PortReply); } catch { close(); }
    };
    const h = handlers[name];
    if (!h) return reply(false, undefined, `${name} is not a call of this core`);
    try {
      reply(true, await h(args, from));
    } catch (e) {
      reply(false, undefined, (e as Error).message);
    }
  });
  unclose = transport.onClose?.(close) ?? (() => {});
  if (closed) unclose();
  return {
    notify: (notice, data) => { if (closed) throw new Error('the port closed'); transport.send({ ew: PORT_VERSION, notice, ...(data === undefined ? {} : { data }) } satisfies PortNotice); },
    close,
  };
}
