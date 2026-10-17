/**
 * The host contract's message vocabulary, version 1 (the files page, Section 5;
 * the plan, Section 3.2; the wave 2 design, D8 to D11). One vocabulary over three
 * transports: a MessagePort handed to a folder in the App's frame, a loopback
 * socket for an installed build's SDK, and a WebSocket to a server. Every message
 * is a JSON object with `ew: 1` and a `type`; a request carries an `id`, and its
 * answer carries `reply_to` with the same id.
 *
 * The contract terminates in the folder's core (its headless module), which runs
 * in a worker in the frame, in the hidden runner, and in a server alike; the
 * folder's page talks to its core over the folder's own port (`port.ts`).
 */
import { z } from 'zod';
import { Asks, FolderRef } from './manifest.js';
import { RefusalDetail } from './refusal.js';

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

/** A path inside the folder: relative, no leading slash, no `..`. */
export const FolderPath = z
  .string()
  .min(1)
  .max(512)
  .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'a path inside the folder');

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * One file of a save's listing. The listing is the complete tree: a path absent from it is a deleted file.
 * Files the host itself writes into a folder whose core is running (the agent's files, its provenance) are
 * the host's to keep: the host merges them into the version it makes from the core's next save, so the
 * core's listing never deletes them.
 */
export const SavedFile = z.object({
  path: FolderPath,
  sha256: Sha256,
  /** Base64 bytes, sent only for files that changed since the last version the host confirmed (at start, the grant's listing). */
  data: z.string().optional(),
});
export type SavedFile = z.infer<typeof SavedFile>;

/** One file of the folder's tree as the host hands it over at start. */
export const TreeFile = z.object({ path: FolderPath, sha256: Sha256, size: z.number().int().nonnegative() });
export type TreeFile = z.infer<typeof TreeFile>;

/**
 * Why a save is asked for or made (PV15; S3 3.5; MR1.4; the wave 2 design, D8).
 * `interval` every 30 seconds; `leaving` on leaving; `pause` when the menu or the
 * terminal opens; `handoff` before another device takes over; `before-change`
 * before each agent change (the undo point); `build` at the end of a build's level;
 * `own` when the folder saves on its own account.
 */
export const SaveReason = z.enum(['interval', 'leaving', 'pause', 'handoff', 'before-change', 'build', 'own']);
export type SaveReason = z.infer<typeof SaveReason>;

/* ---------- The agent's channel: queries, proposals, previews, forecasts (D8, D9) ---------- */

/**
 * A structured query over the documented state (FE.9). Any engine answers the
 * parts it has; an unknown field is ignored and reported in `omitted`.
 */
export const StateQuery = z.object({
  /** The kind of thing: variable, relationship, mechanic, entity, or a word the engine's state form names. */
  kind: z.string().optional(),
  /** A substring of the name. */
  name: z.string().max(200).optional(),
  tags: z.array(z.string()).optional(),
  scope: z.string().optional(),
  /** Neighbours of one thing in the graph: what moves it (`in`), what it moves (`out`), or both, to a depth. */
  near: z.object({ id: z.string().min(1), direction: z.enum(['in', 'out', 'both']).default('both'), depth: z.number().int().min(1).max(4).default(1) }).optional(),
  /** A bounded expression in the engine's expression form, such as `value > 0.5`. */
  where: z.string().max(1000).optional(),
  limit: z.number().int().min(1).max(500).default(50),
  cursor: z.string().optional(),
}).passthrough(); // an engine reports the fields it does not know in `omitted`, so they reach it
export type StateQuery = z.infer<typeof StateQuery>;

/** An item of a preview: one line a person can read, with the ids it touches. */
export const PreviewItem = z.object({ text: z.string().max(500), refs: z.array(z.string()).default([]) });

/**
 * What a change would do, in the four groups the decision card draws (the pack's
 * NP4; S12 12.10): what it adds, what it changes, what it needs, and what it takes.
 */
export const Preview = z.object({
  adds: z.array(PreviewItem).default([]),
  changes: z.array(PreviewItem).default([]),
  needs: z.array(PreviewItem).default([]),
  takes: z.array(PreviewItem).default([]),
});
export type Preview = z.infer<typeof Preview>;

/** A projection of a change, with the drift that would have happened anyway taken out (FE.10). */
export const Forecast = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    /** Reality time projected, in the folder's own unit as its state form documents it. */
    horizon: z.number().nonnegative(),
    deltas: z.array(z.object({ subject: z.string(), from: z.unknown(), to: z.unknown(), text: z.string().max(500).optional() })).default([]),
    events: z.array(z.object({ at: z.number(), level: z.enum(['minor', 'notable', 'major']), text: z.string().max(500) })).default([]),
  }),
  /** An engine that cannot forecast (the engines matrix, Section 4): the change itself is shown. */
  z.object({ available: z.literal(false), reason: z.string().max(500) }),
]);
export type Forecast = z.infer<typeof Forecast>;

/**
 * A change the agent asks for (FE.11; MR14.5): what was asked, in words, and the
 * operations in the engine's own vocabulary, which its interface documents.
 * Expectations are checks the engine can run on the copy.
 */
export const Change = z.object({
  intent: z.string().min(1).max(2000),
  ops: z.array(z.unknown()).default([]),
  expectations: z.array(z.object({ text: z.string().max(500), check: z.unknown().optional() })).default([]),
});
export type Change = z.infer<typeof Change>;

/** The reply to `change.propose`: a stored proposal, its preview, its forecast, and the checks. */
export const Proposal = z.object({
  proposal: z.string().min(1),
  preview: Preview,
  forecast: Forecast,
  checks: z.array(z.object({ text: z.string().max(500), met: z.boolean(), note: z.string().max(500).optional() })).default([]),
  /** What the engine could not do, in words (the engines matrix, Section 4). */
  gaps: z.array(z.string().max(500)).default([]),
  summary: z.string().max(2000).default(''),
});
export type Proposal = z.infer<typeof Proposal>;

/* ---------- Model calls (D10) ---------- */

export const TextModelRequest = z.object({
  kind: z.literal('text').default('text'),
  system: z.string().optional(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).min(1),
  maxTokens: z.number().int().positive().max(64000).optional(),
  /** Ask the host to send `model.part` messages as paragraphs pass the classifier, before the reply. */
  stream: z.boolean().default(false),
});
export const ImageModelRequest = z.object({
  kind: z.literal('image'),
  prompt: z.string().min(1).max(4000),
  /** A style phrase, from the Reality or the person's own (the images module). */
  style: z.string().max(1000).optional(),
  width: z.number().int().min(64).max(2048).default(1024),
  height: z.number().int().min(64).max(2048).default(1024),
});
/** A request with no `kind` is a text request, as `TextModelRequest`'s default says. */
export const ModelRequest = z.preprocess(
  (r) => (r && typeof r === 'object' && !('kind' in r) ? { ...r, kind: 'text' } : r),
  z.discriminatedUnion('kind', [TextModelRequest, ImageModelRequest]),
);
export type ModelRequest = z.infer<typeof ModelRequest>;
export type ModelRequestIn = z.input<typeof TextModelRequest> | z.input<typeof ImageModelRequest>;

/** The reply to a text call: the prose, the notices the platform raised, and the compute it drew. */
export const TextModelReply = z.object({ text: z.string(), notices: z.array(z.string()).default([]), drawUnits: z.number().nonnegative().default(0), exchangeId: z.string().optional() });
/** The reply to an image call: the bytes, which the folder keeps as a file in its own listing. */
export const ImageModelReply = z.object({ image: z.string(), mime: z.string(), notices: z.array(z.string()).default([]), drawUnits: z.number().nonnegative().default(0), exchangeId: z.string().optional() });

/* ---------- From the host to the folder ---------- */

export const HostMessage = z.discriminatedUnion('type', [
  /** The first message: what is granted, where it draws, the account's display settings, and the folder's files. */
  z.object({
    ...base,
    type: z.literal('grant'),
    /** Connection family; combined is only the transitional local 0.3 connection. */
    endpoint: z.enum(['combined', 'core', 'page']).optional(),
    mode: z.enum(['play', 'away', 'session', 'server', 'installed']).optional(),
    players: z.object({ max: z.number().int().min(1).max(10) }).optional(),
    /** Host-owned recap metadata; null means authoritative compute share is unavailable. */
    away: z.object({ pace: Pace, computeShare: z.number().min(0).max(100).nullable() }).optional(),
    asks: Asks,
    session: z.string().min(1),
    display: Display,
    /** Which device runs it: the frame on a screen, or a host with no screen. */
    headless: z.boolean(),
    /** Set only in the journeys build; the folder-side loader answers the runner's requests then. */
    journeys: z.boolean().default(false),
    /** The version started from, which the first save has as its parent. */
    version: z.object({ id: z.string().min(1), seq: z.number().int().nonnegative() }),
    /** The folder's own tree at that version: the baseline for "changed since the last version the host confirmed". */
    files: z.array(TreeFile).max(10000).default([]),
    /** The folders it uses, resolved, as they are laid out under `/uses/<ref>/` on the folder's origin (D6). */
    uses: z.array(z.object({ ref: FolderRef, version: z.string().min(1), kind: z.string() })).default([]),
    /** The person's stored preferences for this folder, held per account across Realities and devices (D30). */
    prefs: z.unknown().optional(),
  }),
  /** Which top corner one of the App's two buttons is using, so the folder keeps it clear (S3 3.3). */
  z.object({ ...base, type: z.literal('corner'), corner: z.enum(['left', 'right']).nullable() }),
  /** The menu or the terminal opened over a Reality played alone (S3 3.3, 3.3b); never while others are present. The reply says when the folder stopped. */
  z.object({ ...req, type: z.literal('pause') }),
  z.object({ ...req, type: z.literal('resume') }),
  z.object({ ...base, type: z.literal('display'), display: Display }),
  /** The installed build or server saves and exits (Wave 3 E16). */
  z.object({ ...req, type: z.literal('quit'), reason: z.string().min(1) }),
  /** Save now, for a reason (PV15). The folder answers with a `save` request of its own, carrying the reason. */
  z.object({ ...base, type: z.literal('save.request'), reason: SaveReason, name: z.string().max(80).optional() }),
  /** Running while away: real time elapsed since the last advance, at the owner's pace (PV23). */
  z.object({ ...base, type: z.literal('advance'), realElapsedMs: z.number().int().nonnegative(), pace: Pace }),
  /** Input, marked with who sent it; with one person present the sender is that person. */
  z.object({ ...base, type: z.literal('input'), sender: z.string().min(1), kind: z.enum(['text', 'pointer', 'keys', 'touch']), data: z.unknown() }),
  /** The App's terminal reaching the Reality (the files page, Section 7): read, query, explain, forecast, change, undo. */
  z.object({ ...req, type: z.literal('state.read'), path: z.string().default('') }),
  z.object({ ...req, type: z.literal('state.query'), query: StateQuery }),
  z.object({ ...req, type: z.literal('state.explain'), subject: z.string().min(1) }),
  /** What would happen: a projection that moves nothing and stores no proposal (FE.10). */
  z.object({ ...req, type: z.literal('change.forecast'), change: Change, horizon: z.number().nonnegative().optional() }),
  /** The Reality Agent loop's first half: apply to a copy, check, report; `revises` names an earlier proposal planned again. */
  z.object({ ...req, type: z.literal('change.propose'), change: Change, revises: z.string().optional() }),
  /** Commit a stored proposal the person approved, or one the approved plan covers during a build (D9). */
  z.object({ ...req, type: z.literal('change.apply'), proposal: z.string().min(1), approvedBy: z.enum(['person', 'plan']).default('person'), decision: z.string().optional() }),
  z.object({ ...req, type: z.literal('change.undo') }),
  /** A person's own layout of the panels and views inside the Reality (the files page, Section 7; S3 F3.42), in the pack's documented form. */
  z.object({ ...req, type: z.literal('layout.set'), layout: z.unknown() }),
  z.object({ ...req, type: z.literal('layout.reset') }),
  /** A paragraph of a streamed model reply, released as it passes the classifier, before the reply closes the call. */
  z.object({ ...base, type: z.literal('model.part'), reply_to: z.number().int(), index: z.number().int().nonnegative(), text: z.string() }),
  /** Answers to the folder's requests. */
  z.object({ ...base, type: z.literal('reply'), reply_to: z.number().int(), ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional(), code: z.string().min(1).optional(), detail: RefusalDetail.optional() }),
]);
export type HostMessage = z.infer<typeof HostMessage>;
/** What a host writes before the schema fills defaults. */
export type HostMessageIn = z.input<typeof HostMessage>;

/* ---------- From the folder to the host ---------- */

export const FolderMessage = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('ready'), protocol: z.literal(PROTOCOL_VERSION) }),
  /**
   * How far along opening is, for the opening board (S3 3.3f); optional. A progress of 1, or the
   * folder's first status line, tells the host the folder has opened (the App's request 7).
   */
  z.object({ ...base, type: z.literal('progress'), fraction: z.number().min(0).max(1), text: z.string().max(140).optional() }),
  /** The one line the home shows for this Reality (MR3.1). */
  z.object({ ...base, type: z.literal('status'), line: z.string().max(140) }),
  /** A save, for a reason: the complete tree, with bytes for what changed. The reply is `{ version, seq, at }`. */
  z.object({ ...req, type: z.literal('save'), reason: SaveReason, files: z.array(SavedFile).max(10000), name: z.string().max(80).optional() }),
  /** A model call for a job the folder names; the host resolves the job's model and routes the call by that job's route (plan compute or the person's own key). */
  z.object({ ...req, type: z.literal('model.call'), job: z.string().min(1), request: ModelRequest }),
  /** Withdraw a request of the folder's own that is still pending (a model call); the host answers it `ok: false`. */
  z.object({ ...base, type: z.literal('cancel'), id: z.number().int().nonnegative() }),
  /** An event the Reality marks; at or above the owner's interrupt level it pauses running while away (PV23). */
  z.object({ ...base, type: z.literal('event'), level: z.enum(['minor', 'notable', 'major']), text: z.string().max(500) }),
  /** The platform's agent inside the folder (the files page, Section 5, the agent), with the reach the grant gives. */
  z.object({ ...req, type: z.literal('agent.ask'), text: z.string().min(1).max(20000) }),
  /** The person's answer to a decision card the folder drew from an `agent.ask` reply. */
  z.object({ ...req, type: z.literal('agent.decide'), decision: z.string().min(1), choice: z.string().min(1).max(80) }),
  /** Counts S13 meters, with no text (MR13.1). */
  z.object({ ...base, type: z.literal('meter'), counts: z.record(z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/), z.number().int().nonnegative()) }),
  /** One of the folder's own files, from the version started from (D8); the reply carries base64 `data`. */
  z.object({ ...req, type: z.literal('file.read'), path: FolderPath }),
  /** A file the person chooses, through the dialog on a computer and the photo library on a phone; the reply is `{ name, mime, data }` or a refusal. */
  z.object({ ...req, type: z.literal('file.pick'), accept: z.array(z.string().min(1)).min(1) }),
  /** A file the person exports; the App saves it through the dialog on a computer and the share sheet on a phone. */
  z.object({ ...req, type: z.literal('file.export'), name: z.string().min(1).max(200), mime: z.string().min(1), data: z.string() }),
  /**
   * The folder asks the App to open one of the App's own surfaces over the frame, which pauses the
   * Reality as the corners do: Saves, the copy flow (MR1.3), the rating (PV10), or a start from a
   * scene's save. No reply; the App may decline silently where the surface does not apply.
   */
  z.object({ ...base, type: z.literal('app.open'), what: z.enum(['saves', 'copy', 'rate', 'start-from', 'away']), detail: z.string().max(200).optional() }),
  /** The person's preferences for this folder, kept per account across Realities and devices (at most 2 MiB as JSON). */
  z.object({ ...req, type: z.literal('prefs.set'), prefs: z.unknown() }),
  z.object({ ...base, type: z.literal('error'), message: z.string().max(2000) }),
  /** Answers to the host's requests (pause, resume, state.*, change.*, layout.*). */
  z.object({ ...base, type: z.literal('reply'), reply_to: z.number().int(), ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional(), code: z.string().min(1).optional(), detail: RefusalDetail.optional() }),
]);
export type FolderMessage = z.infer<typeof FolderMessage>;

/** The reply shapes of the agent's channel, for the host and the agent to parse. */
export const AgentReply = z.object({
  text: z.string(),
  /** A decision asked of the person, drawn as a card by whoever shows the reply. */
  decision: z.object({ id: z.string().min(1), text: z.string().max(500), choices: z.array(z.string().min(1).max(80)).min(1),
    /** Actual stored card kind. Only explicit other is a private question; absence grants no exception. */
    kind: z.enum(['build', 'change', 'layout', 'pause', 'other']).optional(),
  }).optional(),
  /** A proposal the reply describes, so the folder can draw its preview. */
  proposal: Proposal.optional(),
});
export type AgentReply = z.infer<typeof AgentReply>;

/** The reply to a `pause` or `resume` request: the folder's own time when it stopped or went on. */
export const PauseReply = z.object({ at: z.number().optional(), paused: z.boolean() });

/**
 * Whether a folder message is allowed under what was granted. The bridge refuses
 * any message for an ask the manifest does not make (the plan, Section 3.2).
 */
export function permitted(msg: FolderMessage, asks: z.infer<typeof Asks>): { ok: true } | { ok: false; reason: string } {
  switch (msg.type) {
    case 'file.pick':
    case 'file.export':
      return asks.surface !== 'none' ? { ok: true } : { ok: false, reason: 'a visible page is required for file dialogs' };
    case 'save':
      return asks.saves ? { ok: true } : { ok: false, reason: 'the folder did not ask for saves' };
    case 'model.call': {
      // The every-line routing call is the agent's own job (D11): granted to any folder that asks for
      // the agent, with the agent's prompt and bounds supplied by the host, and never a job a person
      // chooses a model for.
      if (msg.job === 'agent.route') return asks.agent !== 'none' && msg.request.kind !== 'image' ? { ok: true } : { ok: false, reason: 'the folder did not ask for the agent' };
      if (!asks.models) return { ok: false, reason: 'the folder did not ask for models' };
      const jobs = msg.request.kind === 'image' ? asks.models.image_jobs : asks.models.jobs;
      return jobs.includes(msg.job) ? { ok: true } : { ok: false, reason: `the folder names no ${msg.request.kind} job ${msg.job}` };
    }
    case 'agent.ask':
    case 'agent.decide':
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
    case 'corner':
    case 'layout.set':
    case 'layout.reset':
      return asks.surface !== 'none';
    default:
      return true;
  }
}
