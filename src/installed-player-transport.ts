import { z } from 'zod';
import type { Transport } from './bridge.js';
import { SOCKET_FRAME_BYTES } from './loopback.js';
import { PortCall, PortNotice, PortReply } from './port.js';

const ProjectionFrame = z.object({
  ewPlayerProjection: z.literal(1),
  frame: z.union([PortCall.strict(), PortReply.strict(), PortNotice.strict()]),
}).strict();
const encoder = new TextEncoder();
const maxUnreadFrames = 1000;
type Closed = (error: Error) => void;

function lane(send: Transport['send'], close: () => void, fail: Closed) {
  const listeners = new Set<(frame: unknown) => void>();
  const closers = new Set<Closed>();
  const unread: unknown[] = [];
  let unreadBytes = 0;
  let closed: Error | undefined;
  const transport: Transport = {
    send(frame) {
      if (closed) throw closed;
      send(frame);
    },
    onMessage(listener) {
      if (closed) throw closed;
      listeners.add(listener);
      const pending = unread.splice(0);
      unreadBytes = 0;
      for (const frame of pending) {
        if (closed) break;
        listener(frame);
      }
      return () => { listeners.delete(listener); };
    },
    onClose(listener) {
      if (closed) listener(closed);
      else closers.add(listener);
      return () => { closers.delete(listener); };
    },
    close,
  };
  return {
    transport,
    receive(frame: unknown) {
      if (closed) return;
      if (listeners.size) {
        for (const listener of listeners) listener(frame);
        return;
      }
      const text = JSON.stringify(frame);
      const bytes = typeof text === 'string' ? encoder.encode(text).byteLength : Infinity;
      if (unread.length >= maxUnreadFrames || unreadBytes + bytes > SOCKET_FRAME_BYTES) {
        fail(new Error('unread installed player transport data exceeds its limit'));
        return;
      }
      unread.push(frame);
      unreadBytes += bytes;
    },
    finish(error: Error) {
      if (closed) return [];
      closed = error;
      listeners.clear();
      unread.length = 0;
      unreadBytes = 0;
      const pending = [...closers];
      closers.clear();
      return pending;
    },
  };
}

function notifyClosed(listeners: Closed[], error: Error) {
  for (const listener of listeners) {
    try { listener(error); } catch { /* One subscriber cannot prevent the other lane's cleanup. */ }
  }
}

/** Split an already admitted installed loopback connection into its raw core and tagged projection lanes. */
export function splitInstalledPlayerTransport(transport: Transport): { core: Transport; projection: Transport } {
  let closed = false;
  let offMessage = () => {};
  let offClose = () => {};
  const closeCore = (error: Error, closeTransport = true) => {
    if (closed) return;
    closed = true;
    const listeners = [...core.finish(error), ...projection.finish(error)];
    offMessage();
    offClose();
    try { if (closeTransport) transport.close(); }
    finally { notifyClosed(listeners, error); }
  };
  const closeProjection = (error: Error) => notifyClosed(projection.finish(error), error);
  const invalidProjection = () => new Error('invalid installed player projection frame');
  const core = lane(frame => transport.send(frame), () => closeCore(new Error('installed core connection closed')), closeCore);
  const projection = lane(frame => {
    try {
      const wrapped = ProjectionFrame.safeParse({ ewPlayerProjection: 1, frame });
      if (!wrapped.success) throw invalidProjection();
      transport.send(wrapped.data);
    } catch {
      const error = invalidProjection();
      closeProjection(error);
      throw error;
    }
  }, () => closeProjection(new Error('installed player projection closed')), closeProjection);

  try {
    offMessage = transport.onMessage(frame => {
      if (typeof frame !== 'object' || frame === null || !('ewPlayerProjection' in frame)) {
        core.receive(frame);
        return;
      }
      try {
        const wrapped = ProjectionFrame.safeParse(frame);
        if (!Object.hasOwn(frame, 'ewPlayerProjection') || !Object.hasOwn(frame, 'frame') || !wrapped.success) throw invalidProjection();
        projection.receive(wrapped.data.frame);
      } catch { closeProjection(invalidProjection()); }
    });
    if (closed) offMessage();
    else {
      offClose = transport.onClose?.(error => closeCore(error, false)) ?? offClose;
      if (closed) offClose();
    }
  } catch (error) {
    closeCore(new Error('installed core connection unavailable'));
    throw error;
  }
  return { core: core.transport, projection: projection.transport };
}
