/**
 * The two files a folder carries beside its manifest when other folders depend
 * on what it does (the plan, Section 3.4; the engines matrix, Sections 2.2, 4, and 6;
 * the wave 2 design, D3, D5, D7):
 *
 * - `interface.json`, carried by an engine: the calls it answers, which of the
 *   asks of the files page Section 5 its code takes, which earlier saves it opens,
 *   where its code is, and the named parts of its documented state.
 * - `contract.json`, carried by a pack or a module: what it needs, what it adds,
 *   what it fits, where its code is, and what it keeps as files.
 *
 * The platform reads only these and the manifest.
 */
import { z } from 'zod';
import semver from 'semver';
import { JobName } from './manifest.js';
import { StudioValidationDeclaration } from './studio-validation.js';

/** The calls an engine answers (the engines matrix, Section 2.2). Pause and resume are the host's, not the engine's. */
export const EngineCall = z.enum(['load', 'save', 'advance', 'input', 'read', 'query', 'explain', 'forecast', 'change']);
export type EngineCall = z.infer<typeof EngineCall>;

/**
 * The asks whose part a folder's own code must take (the engines matrix, Section 4):
 * saves, running while away, players, the agent to read and explain, the agent to
 * change, and models.
 */
export const AskPart = z.enum(['saves', 'while_away', 'players', 'agent.read', 'agent.change', 'models']);
export type AskPart = z.infer<typeof AskPart>;

/** A path to an ES module inside the folder, which another folder's code imports from `/uses/<ref>/<path>` (D6). */
const ModulePath = z.string().min(1).max(512).refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'a path inside the folder');

/** E18 inspection is an optional, pure module over explicitly selected saved bytes. */
const InspectionPath = z.string().min(1).max(512).refine(p => !/[\\:%?#\u0000-\u001f]/.test(p) && !p.startsWith('/') && p.split('/').every(part => !!part && part !== '.' && part !== '..'), 'a relative file path without traversal');
export const SaveInspectionDeclaration = z.object({
  module: InspectionPath,
  files: z.array(InspectionPath).refine(paths => new Set(paths).size === paths.length, 'inspection paths are unique'),
}).strict();
export type SaveInspectionDeclaration = z.infer<typeof SaveInspectionDeclaration>;
export interface SaveInspectionInput { readonly files: ReadonlyMap<string, Uint8Array>; readonly paths: readonly string[] }
export const SaveInspection = z.object({
  status: z.enum(['empty', 'ready', 'update', 'refused']),
  savedFormat: z.number().int().positive().safe().nullable(),
  currentFormat: z.number().int().positive().safe(),
  savedWith: z.string().min(1).max(100).optional(),
  reason: z.string().min(1).max(500).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'empty' && value.savedFormat !== null || value.status === 'ready' && value.savedFormat !== value.currentFormat || value.status === 'update' && (value.savedFormat === null || value.savedFormat === value.currentFormat)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'the inspection status and formats do not agree' });
});
export type SaveInspection = z.infer<typeof SaveInspection>;

export const EngineInterface = z.object({
  calls: z.array(EngineCall).min(1),
  takes: z.array(AskPart).default([]),
  /** The range of the engine's own versions whose saves this version opens without an update; older ones it updates. */
  opens: z.string().refine((r) => semver.validRange(r) !== null, 'opens is a semver range').default('*'),
  /** Whether a change can be shown with a forecast before it is made. */
  forecasts: z.boolean().default(false),
  /** The ES module a folder's core imports to run the engine (`createEngine`); empty for an engine used only in part. */
  module: ModulePath.optional(),
  /** The parts of the engine that a folder may take alone (FE.14), each its own module. */
  parts: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), ModulePath).default({}),
  /** The named parts of the documented state (FE.15), which a contract's `needs.state` names. */
  state: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)).default([]),
  /** A pure compatibility inspection, isolated before a host starts the core. */
  saveInspection: SaveInspectionDeclaration.optional(),
  studioValidation: StudioValidationDeclaration.optional(),
  /** The save format version this engine writes. */
  format: z.number().int().positive().default(1),
});
export type EngineInterface = z.infer<typeof EngineInterface>;

/**
 * A slot a pack gives its modules to fill (the plan, Section 3.8; the pack's
 * matrix, 5.4; the wave 2 design, D8): a line on a dashboard row, a variable's
 * course, a portrait, an icon, the map view, the graph view, a settings section,
 * a picture at a scene's top or asked for in play, and an item a module keeps in
 * a scene artifact.
 */
export const Slot = z.enum(['dashboard-line', 'variable-course', 'portrait', 'icon', 'map-view', 'graph-view', 'settings-section', 'scene-picture', 'artifact-item']);
export type Slot = z.infer<typeof Slot>;

export const FolderContract = z.object({
  studioValidation: StudioValidationDeclaration.optional(),
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
  /** The ES module other folders import: a pack's core and page, a module's slot fillers (D4, D6). */
  module: ModulePath.optional(),
  /**
   * The model a pack recommends for each job it names, which the App shows as the
   * Reality's recommendation (S3 3.2b). The recommendation is a catalogue id. The
   * platform follows a retired model to the model it was retired to, and reports at
   * import an id no catalogue row serves. It is the third step of the person's
   * model for a job: the person's choice for this Reality, their general choice,
   * this recommendation, the catalogue's default.
   */
  recommends: z.record(JobName, z.string().min(1)).default({}),
  /**
   * The files this folder keeps in a Reality's folder, by path prefix, in a form
   * its documents describe: what the agent writes when it builds for the folder
   * and what the folder reads in play (the pack's matrix, 5.4; D9).
   */
  keeps: z.array(z.object({ prefix: z.string().min(1).max(512), description: z.string().max(500) })).default([]),
});
export type FolderContract = z.infer<typeof FolderContract>;
