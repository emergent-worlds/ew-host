/**
 * The two files a folder carries beside its manifest when other folders depend
 * on what it does (the plan, Section 3.4; the engines matrix, Sections 2.2, 4, and 6):
 *
 * - `interface.json`, carried by an engine: the calls it answers, which of the
 *   asks of the files page Section 5 its code takes, and which earlier saves it opens.
 * - `contract.json`, carried by a pack or a module: what it needs, what it adds,
 *   and what it fits.
 *
 * The platform reads only these and the manifest.
 */
import { z } from 'zod';
import semver from 'semver';

/** The calls an engine answers (the engines matrix, Section 2.2). Pause and resume are the host's, not the engine's. */
export const EngineCall = z.enum(['load', 'save', 'advance', 'input', 'read', 'query', 'explain', 'forecast', 'change']);
export type EngineCall = z.infer<typeof EngineCall>;

/** The asks whose part a folder's own code must take (the engines matrix, Section 4). */
export const AskPart = z.enum(['saves', 'while_away', 'players', 'agent.change', 'models']);
export type AskPart = z.infer<typeof AskPart>;

export const EngineInterface = z.object({
  calls: z.array(EngineCall).min(1),
  takes: z.array(AskPart).default([]),
  /** The range of the engine's own versions whose saves this version opens. */
  opens: z.string().refine((r) => semver.validRange(r) !== null, 'opens is a semver range').default('*'),
  /** Whether a change can be shown with a forecast before it is made. */
  forecasts: z.boolean().default(false),
});
export type EngineInterface = z.infer<typeof EngineInterface>;

/** A slot a pack gives its modules to fill (the plan, Section 3.8). */
export const Slot = z.enum(['dashboard-line', 'variable-course', 'portrait', 'icon', 'map-view', 'graph-view', 'settings-section']);

export const FolderContract = z.object({
  needs: z
    .object({
      calls: z.array(EngineCall).default([]),
      /** Named parts of the engine's documented state the folder reads. */
      state: z.array(z.string()).default([]),
    })
    .default({}),
  adds: z
    .object({
      slots: z.array(Slot).default([]),
      /** Slots this folder gives to others (a pack). */
      gives: z.array(Slot).default([]),
    })
    .default({}),
  /** What it fits: the kinds and folders it is made for, by name and range. */
  fits: z.record(z.string(), z.string()).default({}),
});
export type FolderContract = z.infer<typeof FolderContract>;
