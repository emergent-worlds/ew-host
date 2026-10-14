/**
 * The host contract's message vocabulary, version 1 (the files page, Section 5;
 * the plan, Section 3.2). One vocabulary over three transports: a MessagePort
 * handed to a folder in the App's frame, a loopback socket for an installed
 * build's SDK, and a WebSocket to a server. Every message is a JSON object with
 * `ew: 1` and a `type`; a request carries an `id`, and its answer carries
 * `reply_to` with the same id.
 */
import { z } from 'zod';
import { Asks } from './manifest.js';

export const PROTOCOL_VERSION = 1 as const;

const base = { ew: z.literal(PROTOCOL_VERSION) };
const req = { ...base, id: z.number().int().nonnegative() };

/** The display settings the account carries into every Reality (S2 2.14; MR9.8). */
export const Display = z.object({
  theme: z.enum(['light', 'dark']),
  textSize: z.enum(['small', 'default', 'large', 'larger']),
  contrast: z.enum(['default', 'high']),
  motion: z.enum(['full', 'reduced']),
  language: z.string().default('en'),
});
export type Display = z.infer<typeof Display>;

/** The pace of running while away: an hour, a day, or a week in the Reality per real hour (PV23). */
export const Pace = z.enum(['hour', 'day', 'week']);

const SavedFile = z.object({
  path: z.string().min(1).max(512).refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'a path inside the folder'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Base64 bytes, sent only for files that changed since the last version the host confirmed. */
  data: z.string().optional(),
});

/* ---------- From the host to the folder ---------- */

export const HostMessage = z.discriminatedUnion('type', [
  /** The first message: what is granted, where it draws, and the account's display settings. */
  z.object({
    ...base,
    type: z.literal('grant'),
    asks: Asks,
    session: z.string().min(1),
    display: Display,
    /** Which device runs it: the frame on a screen, or a host with no screen. */
    headless: z.boolean(),
    /** Set only in the journeys build; the folder-side loader answers the runner's requests then. */
    journeys: z.boolean().default(false),
  }),
  /** Which top corner one of the App's two buttons is using, so the folder keeps it clear (S3 3.3). */
  z.object({ ...base, type: z.literal('corner'), corner: z.enum(['left', 'right']).nullable() }),
  /** The menu or the terminal opened over a Reality played alone (S3 3.3, 3.3b); never while others are present. */
  z.object({ ...base, type: z.literal('pause') }),
  z.object({ ...base, type: z.literal('resume') }),
  z.object({ ...base, type: z.literal('display'), display: Display }),
  /** Every 30 seconds and on leaving (PV15), and before a handoff. */
  z.object({ ...req, type: z.literal('save.request'), reason: z.enum(['interval', 'leaving', 'handoff', 'before-change']) }),
  /** Running while away: real time elapsed since the last advance, at the owner's pace (PV23). */
  z.object({ ...base, type: z.literal('advance'), realElapsedMs: z.number().int().nonnegative(), pace: Pace }),
  /** Input, marked with who sent it; with one person present the sender is that person. */
  z.object({ ...base, type: z.literal('input'), sender: z.string().min(1), kind: z.enum(['text', 'pointer', 'keys', 'touch']), data: z.unknown() }),
  /** The App's terminal reaching the Reality (the files page, Section 7): read, query, explain, forecast, change, undo. */
  z.object({ ...req, type: z.literal('state.read'), path: z.string().default('') }),
  z.object({ ...req, type: z.literal('state.query'), query: z.string().min(1) }),
  z.object({ ...req, type: z.literal('state.explain'), subject: z.string().min(1) }),
  z.object({ ...req, type: z.literal('change.propose'), change: z.unknown() }),
  z.object({ ...req, type: z.literal('change.apply'), proposal: z.string().min(1) }),
  z.object({ ...req, type: z.literal('change.undo') }),
  /** Answers to the folder's requests. */
  z.object({ ...base, type: z.literal('reply'), reply_to: z.number().int(), ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() }),
]);
export type HostMessage = z.infer<typeof HostMessage>;

/* ---------- From the folder to the host ---------- */

export const FolderMessage = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('ready'), protocol: z.literal(PROTOCOL_VERSION) }),
  /** The one line the home shows for this Reality (MR3.1). */
  z.object({ ...base, type: z.literal('status'), line: z.string().max(140) }),
  /** A save, answering a save.request or on the folder's own account. */
  z.object({ ...req, type: z.literal('save'), files: z.array(SavedFile).max(10000), reply_to: z.number().int().optional() }),
  /** A model call for a job the folder names; the host routes it on the person's compute or own key. */
  z.object({
    ...req,
    type: z.literal('model.call'),
    job: z.string().min(1),
    request: z.object({
      system: z.string().optional(),
      messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).min(1),
      maxTokens: z.number().int().positive().max(64000).optional(),
    }),
  }),
  /** An event the Reality marks; at or above the owner's interrupt level it pauses running while away (PV23). */
  z.object({ ...base, type: z.literal('event'), level: z.enum(['minor', 'notable', 'major']), text: z.string().max(500) }),
  /** The platform's agent inside the folder (the files page, Section 5, the agent). */
  z.object({ ...req, type: z.literal('agent.ask'), text: z.string().min(1).max(20000) }),
  /** Counts S13 meters, with no text (MR13.1). */
  z.object({ ...base, type: z.literal('meter'), counts: z.record(z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/), z.number().int().nonnegative()) }),
  /** A file the person exports; the App saves it through the dialog on a computer and the share sheet on a phone. */
  z.object({ ...req, type: z.literal('file.export'), name: z.string().min(1).max(200), mime: z.string().min(1), data: z.string() }),
  z.object({ ...base, type: z.literal('error'), message: z.string().max(2000) }),
  /** Answers to the host's requests (state.*, change.*, save.request). */
  z.object({ ...base, type: z.literal('reply'), reply_to: z.number().int(), ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() }),
]);
export type FolderMessage = z.infer<typeof FolderMessage>;

/**
 * Whether a folder message is allowed under what was granted. The bridge refuses
 * any message for an ask the manifest does not make (the plan, Section 3.2).
 */
export function permitted(msg: FolderMessage, asks: z.infer<typeof Asks>): { ok: true } | { ok: false; reason: string } {
  switch (msg.type) {
    case 'save':
      return asks.saves ? { ok: true } : { ok: false, reason: 'the folder did not ask for saves' };
    case 'model.call':
      if (!asks.models) return { ok: false, reason: 'the folder did not ask for models' };
      return asks.models.jobs.includes(msg.job) ? { ok: true } : { ok: false, reason: `the folder names no job ${msg.job}` };
    case 'agent.ask':
      return asks.agent !== 'none' ? { ok: true } : { ok: false, reason: 'the folder did not ask for the agent' };
    default:
      return { ok: true };
  }
}

/** Whether a host message may be sent to a folder under what was granted. */
export function deliverable(msg: HostMessage, asks: z.infer<typeof Asks>): boolean {
  switch (msg.type) {
    case 'input':
      return asks.input.includes(msg.kind);
    case 'advance':
      return asks.while_away;
    case 'save.request':
      return asks.saves;
    default:
      return true;
  }
}
