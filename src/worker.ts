/** E11: adapt a runtime worker to the same host contract. This is not a sandbox. */
import type { Transport } from './bridge.js';

/** Node's worker_threads Worker. No Node import reaches browser consumers. */
export interface NodeWorkerEndpoint {
  postMessage(message: unknown): void;
  on(type: 'message', listener: (message: unknown) => void): unknown;
  on(type: 'messageerror' | 'error', listener: (error: Error) => void): unknown;
  on(type: 'exit', listener: (code: number) => void): unknown;
  off(type: 'message', listener: (message: unknown) => void): unknown;
  off(type: 'messageerror' | 'error', listener: (error: Error) => void): unknown;
  off(type: 'exit', listener: (code: number) => void): unknown;
  terminate(): void | Promise<number>;
}

/** Bun's Worker and browser workers use EventTarget; Bun additionally emits close. */
export interface WebWorkerEndpoint {
  postMessage(message: unknown): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  terminate(): void | Promise<number>;
}

/** The startup buffer is an internal guard, not a limit on an attached connection. */
export const WORKER_STARTUP_MESSAGES = 1000;

export function workerTransport(worker: NodeWorkerEndpoint | WebWorkerEndpoint): Transport {
  const listeners = new Set<(message: unknown) => void>();
  const closeListeners = new Set<(error: Error) => void>();
  const queued: unknown[] = [];
  const unsubscribe: (() => void)[] = [];
  let closed = false;
  let reason = new Error('worker connection closed');

  const stop = (error = new Error('worker connection closed')) => {
    if (closed) return;
    closed = true;
    reason = error;
    for (const remove of unsubscribe) remove();
    listeners.clear(); queued.length = 0;
    // Termination is requested here; the owning runner observes native process
    // lifecycle separately and must not treat this notification as graceful quit.
    try { void Promise.resolve(worker.terminate()).catch(() => {}); } catch { /* Already stopped. */ }
    for (const listener of [...closeListeners]) listener(error);
    closeListeners.clear();
  };
  const message = (value: unknown) => {
    if (closed) return;
    if (listeners.size) for (const listener of listeners) listener(value);
    else if (queued.length < WORKER_STARTUP_MESSAGES) queued.push(value);
    else stop(new Error('worker startup data exceeds its limit'));
  };
  const failed = () => stop(new Error('worker connection failed'));
  const ended = () => stop();

  if ('addEventListener' in worker) {
    const received: EventListener = event => message((event as MessageEvent).data);
    for (const [type, fn] of [['message', received], ['messageerror', failed], ['error', failed], ['close', ended]] as const) {
      worker.addEventListener(type, fn);
      unsubscribe.push(() => worker.removeEventListener(type, fn));
    }
  } else {
    worker.on('message', message);
    worker.on('messageerror', failed);
    worker.on('error', failed);
    worker.on('exit', ended);
    unsubscribe.push(() => worker.off('message', message), () => worker.off('messageerror', failed), () => worker.off('error', failed), () => worker.off('exit', ended));
  }

  return {
    send(value) {
      if (closed) throw reason;
      try { worker.postMessage(value); }
      catch { stop(new Error('worker message could not be sent')); throw reason; }
    },
    onMessage(listener) {
      if (closed) throw reason;
      listeners.add(listener);
      for (const value of queued.splice(0)) {
        if (closed || !listeners.has(listener)) break;
        listener(value);
      }
      return () => { listeners.delete(listener); };
    },
    onClose(listener) {
      if (closed) { listener(reason); return () => {}; }
      closeListeners.add(listener);
      return () => { closeListeners.delete(listener); };
    },
    close: () => stop(),
  };
}
