/** E8's direction-specific, version-1 player wire. These frames never carry host/core grants. */
import { z } from 'zod';
import { InputKind, OwnerHandle } from './manifest.js';
import { PortCall, PortNotice, PortReply } from './port.js';
import { SOCKET_FRAME_BYTES } from './loopback.js';

const seq = z.number().int().safe().nonnegative();
const positive = z.number().int().safe().positive();
const opaque = z.string().min(1);
const base = { v: z.literal(1) };
const ctl = { ...base, ch: z.literal('ctl') };
const request = { ...base, requestId: opaque };
export const RemotePortCall = PortCall.extend({ id: seq }).strict();
export const RemotePortNotice = PortNotice.strict();
export const RemotePortReply = PortReply.extend({ reply_to: seq }).strict();
export const RemoteAdmitted = z.object({ ...ctl, type: z.literal('admitted'), slotId: opaque, sender: z.string().min(1).max(200), epoch: positive, resume: opaque }).strict();
export const RemotePlayer = z.object({ sender: z.string().min(1).max(200), handle: OwnerHandle, host: z.boolean() }).strict();
export const RemoteClientFrame = z.union([
  z.object({ ...ctl, type: z.literal('join'), token: opaque }).strict(),
  z.object({ ...ctl, type: z.literal('resume'), credential: opaque, lastSeq: seq }).strict(),
  z.object({ ...ctl, type: z.literal('ack'), seq }).strict(),
  z.object({ ...ctl, type: z.literal('leave') }).strict(),
  z.object({ ...request, ch: z.literal('port'), body: RemotePortCall }).strict(),
  z.object({ ...request, ch: z.literal('input'), kind: InputKind, data: z.unknown().refine(value => value !== undefined, 'input has data') }).strict(),
  z.object({ ...request, ch: z.literal('agent'), type: z.literal('ask'), text: z.string().min(1) }).strict(),
  z.object({ ...request, ch: z.literal('agent'), type: z.literal('decide'), decision: opaque, choice: opaque }).strict(),
]);
export const RemoteServerFrame = z.union([
  RemoteAdmitted,
  z.object({ ...ctl, type: z.literal('snapshot'), seq, notices: z.array(RemotePortNotice) }).strict(),
  z.object({ ...ctl, type: z.literal('sync'), seq, mode: z.enum(['snapshot', 'replay']) }).strict(),
  z.object({ ...ctl, type: z.literal('ready'), seq }).strict(),
  z.object({ ...ctl, type: z.literal('players'), present: z.array(RemotePlayer).max(10), max: z.number().int().min(1).max(10) }).strict().refine(frame => frame.present.length <= frame.max && new Set(frame.present.map(player => player.sender)).size === frame.present.length, 'the player list fits its distinct slots'),
  z.object({ ...ctl, type: z.literal('policy'), terminal: z.enum(['host', 'everyone']) }).strict(),
  z.object({ ...ctl, type: z.literal('saved'), at: z.string().min(1) }).strict(),
  z.object({ ...ctl, type: z.literal('ending'), reason: z.string() }).strict(),
  z.object({ ...ctl, type: z.literal('error'), code: opaque, message: z.string() }).strict(),
  z.object({ ...base, ch: z.literal('port'), seq: positive, body: RemotePortNotice }).strict(),
  z.object({ ...request, ch: z.literal('port'), body: RemotePortReply }).strict(),
  z.object({ ...request, ch: z.literal('input'), ok: z.boolean(), error: z.string().optional() }).strict(),
  z.object({ ...request, ch: z.literal('agent'), type: z.literal('part'), text: z.string() }).strict(),
  z.object({ ...request, ch: z.literal('agent'), type: z.literal('result'), ok: z.boolean(), text: z.string().optional(), decision: z.unknown().optional(), proposal: z.unknown().optional(), error: z.string().optional() }).strict(),
]);
export type RemotePortCall = z.infer<typeof RemotePortCall>;
export type RemotePortNotice = z.infer<typeof RemotePortNotice>;
export type RemotePortReply = z.infer<typeof RemotePortReply>;
export type RemoteAdmitted = z.infer<typeof RemoteAdmitted>;
export type RemotePlayer = z.infer<typeof RemotePlayer>;
export type RemoteClientFrame = z.infer<typeof RemoteClientFrame>;
export type RemoteServerFrame = z.infer<typeof RemoteServerFrame>;

function parse<S extends z.ZodTypeAny>(text: unknown, schema: S): z.output<S> {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > SOCKET_FRAME_BYTES) throw new Error('invalid remote JSON text frame');
  try { return schema.parse(JSON.parse(text)); } catch { throw new Error('invalid remote frame'); }
}
export const parseRemoteClientFrame = (text: unknown): RemoteClientFrame => parse(text, RemoteClientFrame);
export const parseRemoteServerFrame = (text: unknown): RemoteServerFrame => parse(text, RemoteServerFrame);
function encode(value: unknown, schema: z.ZodTypeAny): string {
  try {
    const parsed = schema.parse(value);
    const visit = (part: unknown, seen = new Set<object>()): void => {
      if (part === null || typeof part === 'string' || typeof part === 'boolean') return;
      if (typeof part === 'number' && Number.isFinite(part)) return;
      if (!part || typeof part !== 'object' || seen.has(part)) throw new Error();
      if (!Array.isArray(part) && Object.getPrototypeOf(part) !== Object.prototype && Object.getPrototypeOf(part) !== null) throw new Error();
      seen.add(part);
      if (Array.isArray(part)) for (const item of part) visit(item, seen);
      else for (const item of Object.values(part)) if (item !== undefined) visit(item, seen);
      seen.delete(part);
    };
    visit(parsed);
    const frame = JSON.stringify(parsed);
    if (new TextEncoder().encode(frame).byteLength > SOCKET_FRAME_BYTES) throw new Error();
    return frame;
  } catch { throw new Error('invalid or oversized remote frame'); }
}
export const encodeRemoteClientFrame = (frame: RemoteClientFrame): string => encode(frame, RemoteClientFrame);
export const encodeRemoteServerFrame = (frame: RemoteServerFrame): string => encode(frame, RemoteServerFrame);
