/** S8.4/PV54: declared pure exact-byte validation, distinct from an overall Studio pass. */
import { z } from 'zod';
import { portablePath } from './builds.js';
import { sha256 } from './sha256.js';
const safePath = (path: string) => portablePath(path) && !/[%#]/.test(path);
const OwnRead = z.string().min(1).max(512).refine(path => safePath(path.endsWith('/') ? path.slice(0, -1) : path) && path.split('/')[0]!.toLowerCase() !== 'uses', 'an exact own-file path or trailing-slash prefix');
export const StudioValidationDeclaration = z.object({
  module: z.string().min(1).max(512).refine(safePath, 'a confined portable module path'),
  reads: z.array(OwnRead).refine(reads => new Set(reads.map(read => read.toLowerCase())).size === reads.length, 'read declarations are unique'),
}).strict();
export type StudioValidationDeclaration = z.infer<typeof StudioValidationDeclaration>;
const Count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const StudioSnapshot = z.object({ versionId: z.string().min(1), treeSha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export const StudioTreeFile = z.object({ path: z.string().refine(safePath), sha256: z.string().regex(/^[0-9a-f]{64}$/), size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export interface StudioSavedInput {
  readonly snapshot: z.infer<typeof StudioSnapshot>;
  readonly manifest: unknown;
  readonly paths: readonly string[];
  readonly tree?: readonly z.infer<typeof StudioTreeFile>[];
  readonly files: ReadonlyMap<string, Uint8Array>;
}
export interface StudioValidationInput extends StudioSavedInput { readonly requestedTicks: number }
export const StudioValidationFinding = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
  title: z.string().min(1).max(200), state: z.enum(['pass', 'fail', 'unavailable']), detail: z.string().min(1).max(500),
}).strict();
export const StudioValidationRun = z.object({
  state: z.enum(['pass', 'fail', 'unavailable']), requestedTicks: Count.refine(n => n > 0), completedTicks: Count,
  initialTick: Count.nullable(), finalTick: Count.nullable(), detail: z.string().min(1).max(500),
}).strict().superRefine((run, ctx) => {
  const { completedTicks: made, requestedTicks: requested, initialTick: start, finalTick: end } = run;
  if (made > requested || (start === null) !== (end === null) || start === null && made !== 0 || start !== null && end !== null && end - start !== made || run.state === 'pass' && (made !== requested || start === null || end === null)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'the run must describe actual counted ticks' });
});
export const StudioValidationResult = z.object({ checks: z.array(StudioValidationFinding).min(1), run: StudioValidationRun }).strict().superRefine((result, ctx) => {
  if (new Set(result.checks.map(check => check.id)).size !== result.checks.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'validation check ids are unique' });
});
export type StudioValidationResult = z.infer<typeof StudioValidationResult>;
export type StudioValidator = (input: StudioValidationInput) => StudioValidationResult | Promise<StudioValidationResult>;

/** The trusted caller verifies tree hashes first; this selection neither reads a source nor grants access. */
export function studioSavedInput(declaration: StudioValidationDeclaration, input: StudioSavedInput): StudioSavedInput {
  const declared = StudioValidationDeclaration.parse(declaration), snapshot = StudioSnapshot.parse(input.snapshot);
  if (new Set(input.paths.map(path => path.toLowerCase())).size !== input.paths.length || input.paths.some(path => !safePath(path) || path.split('/')[0]!.toLowerCase() === 'uses')) throw new Error('invalid Studio own-file inventory');
  const tree = input.tree?.map(file => StudioTreeFile.parse(file));
  if (tree && (tree.length !== input.paths.length || new Set(tree.map(file => file.path)).size !== tree.length || tree.some(file => !input.paths.includes(file.path)))) throw new Error('Studio tree metadata differs from the own inventory');
  const byPath = new Map(tree?.map(file => [file.path, file]) ?? []);
  const selected = new Map<string, Uint8Array>();
  for (const path of input.paths) {
    if (!declared.reads.some(read => read.endsWith('/') ? path.startsWith(read) : path === read)) continue;
    const bytes = input.files.get(path); if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== '[object Uint8Array]') throw new Error('selected Studio bytes are missing');
    const metadata = byPath.get(path); if (tree && (!metadata || metadata.size !== bytes.byteLength || metadata.sha256 !== sha256(bytes))) throw new Error('selected Studio bytes differ from verified tree metadata');
    selected.set(path, new Uint8Array(bytes));
  }
  return { snapshot, manifest: structuredClone(input.manifest), paths: [...input.paths], files: selected, ...(tree ? { tree } : {}) };
}
export function studioValidationInput(declaration: StudioValidationDeclaration, input: StudioValidationInput): StudioValidationInput {
  if (!Number.isSafeInteger(input.requestedTicks) || input.requestedTicks <= 0) throw new Error('invalid validation tick count');
  return { ...studioSavedInput(declaration, input), requestedTicks: input.requestedTicks };
}
/** A module cannot lower the caller's required run length in its reply. */
export function checkedStudioValidation(value: unknown, requestedTicks: number): StudioValidationResult {
  const result = StudioValidationResult.parse(value);
  if (!Number.isSafeInteger(requestedTicks) || requestedTicks <= 0 || result.run.requestedTicks !== requestedTicks) throw new Error('validation changed the requested tick count');
  return result;
}
