/**
 * The manifest: `manifest.json` at the root of every folder, the only thing the
 * platform reads to know what a folder is (the files page, Section 3; MR2.1).
 *
 * The record settles the eleven field names; their shapes are settled here, in
 * code, when the manifest is first read. Kinds are words, not a list the
 * platform behaves differently on (the files page, Section 2).
 */
import { z } from 'zod';
import semver from 'semver';

/** A folder's name as other folders refer to it: `@owner/name`. */
export const FolderRef = z
  .string()
  .regex(/^@[a-z0-9][a-z0-9_-]{0,38}\/[a-z0-9][a-z0-9._-]{0,99}$/, 'a folder is named @owner/name in lower case');
export type FolderRef = z.infer<typeof FolderRef>;

/** An owner: a person or an organization, by handle (the files page, Section 2). */
export const OwnerHandle = z.string().regex(/^@[a-z0-9][a-z0-9_-]{0,38}$/, 'an owner is an @handle');

const SemverVersion = z.string().refine((v) => semver.valid(v) !== null, 'a version is semver, such as 1.0.0');
const SemverRange = z.string().refine((r) => semver.validRange(r) !== null, 'a range is a semver range, such as ^1');

/** How a part was taken from its source (the files page, Section 8). */
export const DerivationHow = z.enum(['fork', 'copy', 'apply']);

/**
 * One entry of `derived_from`: a folder at a version, or a registered property,
 * the whole of it or a named part, and how it was taken.
 */
export const Derivation = z.object({
  source: z.union([
    z.string().regex(/^@[a-z0-9][a-z0-9_-]{0,38}\/[a-z0-9][a-z0-9._-]{0,99}@[^@\s]+$/, 'a source folder is @owner/name@version'),
    z.string().regex(/^property:[A-Za-z0-9_-]{1,64}$/, 'a registered property is property:<id>'),
  ]),
  part: z.string().min(1).default('*'),
  how: DerivationHow,
});
export type Derivation = z.infer<typeof Derivation>;

/** What others may do with a folder (the files page, Section 3 and Section 8). */
export const Terms = z.object({
  /** block, track, or monetize with a share. */
  mode: z.enum(['block', 'track', 'monetize']).default('track'),
  /** The share a derived work pays when monetized, 0 to 1; a fork pays 25 percent unless set (PV11). */
  share: z.number().min(0).max(1).optional(),
  credit: z.string().max(200).optional(),
  forks: z.boolean().default(true),
  /** People licensed on other terms, by handle. */
  licensees: z.array(OwnerHandle).default([]),
  /** A one-time price in Inspiration; absent means free (PV14). */
  price: z.number().int().min(0).optional(),
  maturity_ceiling: z.enum(['general', 'mild', 'moderate', 'restricted']).optional(),
  themes_not_allowed: z.array(z.string()).default([]),
});
export type Terms = z.infer<typeof Terms>;

/** A system an installed build can be made for (the files page, Section 4). */
export const BuildTarget = z.enum(['windows-x64', 'macos-arm64', 'macos-x64', 'linux-x64', 'server']);
export type BuildTarget = z.infer<typeof BuildTarget>;

/**
 * How a folder runs: a web page the App starts, builds that install on a
 * computer, or both. `headless` is the module a host starts with no screen; it is
 * required when the folder asks to run while away or for more than one person
 * (the plan, Section 3.2).
 */
export const Entry = z
  .object({
    web: z.string().min(1).optional(),
    headless: z.string().min(1).optional(),
    installs: z.record(BuildTarget, z.string().min(1)).optional(),
  })
  .refine((e) => e.web !== undefined || e.installs !== undefined, 'an entry names a web page, builds that install, or both');
export type Entry = z.infer<typeof Entry>;

/** A job a folder names for a model call (the files page, Section 5, models). */
export const JobName = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/);

/** Where a folder draws (the files page, Section 5, surface). */
export const SurfaceAsk = z.enum(['none', 'full', 'panel', 'window']);
/** What reaches a folder (the files page, Section 5, input). */
export const InputKind = z.enum(['text', 'pointer', 'keys', 'touch']);

/** What a folder asks of the host (the files page, Section 5). Absent asks are not granted. */
export const Asks = z.object({
  surface: SurfaceAsk.default('none'),
  input: z.array(InputKind).default([]),
  saves: z.boolean().default(false),
  /**
   * The jobs the folder names for model calls; the person chooses the model for
   * each (S3 3.2b). `jobs` call a language model; `image_jobs` call an image model
   * and are granted only where the route offers one (the wave 2 design, D10).
   */
  models: z
    .object({
      jobs: z.array(JobName).min(1),
      image_jobs: z.array(JobName).default([]),
    })
    .optional(),
  /** The platform's agent inside the folder, and its reach (the files page, Section 5, the agent). */
  agent: z.enum(['none', 'read', 'change']).default('none'),
  /** The named hosts the folder may reach, if any. */
  network: z.array(z.string().regex(/^[a-z0-9.-]+(:\d{1,5})?$/i, 'a host name, with an optional port')).default([]),
  /** Whether it may keep running with no screen while no one is playing (PV23). */
  while_away: z.boolean().default(false),
  /** The most people present at once: one unless set, at most 10 (PV24). */
  players: z.number().int().min(1).max(10).default(1),
});
export type Asks = z.infer<typeof Asks>;

export const Manifest = z
  .object({
    name: z.string().min(1).max(100),
    /** A word, not a list: reality, pack, module, engine, agent, assets, or anything else (the files page, Section 2). */
    kind: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    description: z.string().max(2000).default(''),
    version: SemverVersion,
    owner: OwnerHandle,
    /** The folders it needs, by name and version range. */
    uses: z.record(FolderRef, SemverRange).default({}),
    derived_from: z.array(Derivation).default([]),
    terms: Terms.default({}),
    entry: Entry.optional(),
    asks: Asks.optional(),
    tags: z.array(z.string().regex(/^[a-z0-9][a-z0-9 -]{0,39}$/)).max(20).default([]),
  })
  .superRefine((m, ctx) => {
    // A folder that runs makes asks. A Reality with no entry of its own takes the
    // entry of the nearest folder in its uses that names one, usually its pack
    // (the wave 2 design, D5); the resolver finds it.
    if (m.asks && !m.entry && Object.keys(m.uses).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['asks'], message: 'only a folder that runs (one with an entry, or one that uses a folder with an entry) makes asks' });
    }
    const needsHeadless = m.asks && (m.asks.while_away || m.asks.players > 1);
    if (needsHeadless && m.entry?.web !== undefined && m.entry.headless === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entry', 'headless'],
        message: 'a web entry that runs while away or with more than one person names its headless module',
      });
    }
  });
export type Manifest = z.infer<typeof Manifest>;

/** The result of reading a manifest: a manifest is stored even when invalid, flagged (the plan, Section 3.4). */
export type ReadResult =
  | { valid: true; manifest: Manifest }
  | { valid: false; issues: { path: string; message: string }[] };

/** Reads `manifest.json` text. Never throws on bad input. */
export function readManifest(text: string): ReadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { valid: false, issues: [{ path: '', message: `manifest.json is not JSON: ${(e as Error).message}` }] };
  }
  const parsed = Manifest.safeParse(raw);
  if (parsed.success) return { valid: true, manifest: parsed.data };
  return {
    valid: false,
    issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}

/**
 * The tags the platform reads from a manifest rather than the maker choosing them
 * (the files page, Section 3): uses an engine, uses a terminal agent, installs on
 * your computer. `engineKinds` maps a used folder to its kind, since the
 * manifest names folders, not kinds.
 */
export function readTags(m: Manifest, kindOf: (ref: string) => string | undefined): string[] {
  const tags: string[] = [];
  for (const ref of Object.keys(m.uses)) {
    if (kindOf(ref) === 'engine') tags.push(`uses ${ref}`);
  }
  if (m.asks && m.asks.agent !== 'none') tags.push('uses a terminal agent');
  if (m.entry?.installs && Object.keys(m.entry.installs).length > 0) tags.push('installs on your computer');
  return tags;
}
