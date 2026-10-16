/** PV54: exact authored sampling input; it confers no model or passing-check authority. */
import { z } from 'zod';
import { portablePath } from './builds.js';
import { studioSavedInput, StudioValidationDeclaration, type StudioSavedInput } from './studio-validation.js';
const corpusPath = z.string().min(1).max(512).refine(path => portablePath(path) && !/[%#]/.test(path) && path.split('/')[0]!.toLowerCase() !== 'uses', 'an explicit saved own corpus path');
export const StudioSamplingDeclaration = StudioValidationDeclaration.extend({ corpus: corpusPath }).strict();
export type StudioSamplingDeclaration = z.infer<typeof StudioSamplingDeclaration>;
export const StudioSamplingCorpus = z.object({
 name: z.string().trim().min(1).max(200), setup: z.unknown().optional(),
 turns: z.array(z.object({ id: z.string().min(1).max(200), input: z.unknown() }).strict().refine(turn => Object.hasOwn(turn, 'input'), 'an authored turn has explicit input')).min(1),
}).strict().superRefine((corpus, context) => {
 if (new Set(corpus.turns.map(turn => turn.id)).size !== corpus.turns.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'authored turn identities are unique' });
});
export type StudioSamplingCorpus = z.infer<typeof StudioSamplingCorpus>;
const Count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), Hash = z.string().regex(/^[0-9a-f]{64}$/);
export const StudioSamplingDependency = z.object({ ref: z.string(), version: z.string(), kind: z.string(), folderId: z.string(), versionId: z.string(), treeSha256: Hash }).strict();
export const StudioSamplingTurn = z.object({ id: z.string(), inputSha256: Hash, beforeTick: Count, afterTick: Count, beforeHash: Hash, afterHash: Hash, beforeTurns: Count, afterTurns: Count, callFrom: Count.refine(value => value > 0), callTo: Count.refine(value => value > 0) }).strict();
export const StudioSamplingDescriptionInventory = z.object({ scope: z.string().regex(/^[a-z][a-z0-9_.-]{0,99}$/), items: z.array(z.object({ sourceSha256: Hash, textSha256: Hash, callSequence: Count.refine(value => value > 0).nullable() }).strict()) }).strict();
export const StudioSamplingObservation = z.object({ state: z.enum(['unavailable', 'failed']), detail: z.string().min(1).max(500), turns: z.array(StudioSamplingTurn).optional(), descriptions: StudioSamplingDescriptionInventory.optional(), templates: StudioSamplingDescriptionInventory.optional() }).strict();
export type StudioSamplingObservation = z.infer<typeof StudioSamplingObservation>;
export interface StudioSamplingInput extends StudioSavedInput { readonly corpus: StudioSamplingCorpus; readonly requestedTurns: number; readonly resolved?: readonly z.infer<typeof StudioSamplingDependency>[] }
/** The caller verifies the corpus's immutable path/hash before selecting these cloned data. */
export function studioSamplingInput(declaration: StudioSamplingDeclaration, input: StudioSamplingInput): StudioSamplingInput {
 const declared = StudioSamplingDeclaration.parse(declaration);
 if (!Number.isSafeInteger(input.requestedTurns) || input.requestedTurns <= 0) throw new Error('sampling requests a positive counted number of actual turns');
 return { ...studioSavedInput({ module: declared.module, reads: declared.reads }, input), corpus: structuredClone(StudioSamplingCorpus.parse(input.corpus)), requestedTurns: input.requestedTurns, ...(input.resolved ? { resolved: input.resolved.map(value => StudioSamplingDependency.parse(value)) } : {}) };
}
/** Structural measured evidence is distinct from independent semantic certification. */
export function checkedStudioSampling(value: unknown, requestedTurns: number, authored: readonly { id: string; inputSha256: string }[]): StudioSamplingObservation {
 const observation = StudioSamplingObservation.parse(value), turns = observation.turns ?? [];
 if (!Number.isSafeInteger(requestedTurns) || requestedTurns <= 0 || turns.length > requestedTurns || turns.length > authored.length) throw new Error('sampled turns exceed the requested authored prefix');
 for (let index = 0; index < turns.length; index++) {
  const turn = turns[index]!, expected = authored[index]!, prior = turns[index - 1];
  if (turn.id !== expected.id || turn.inputSha256 !== expected.inputSha256 || turn.afterTick < turn.beforeTick || turn.afterTurns !== turn.beforeTurns + 1 || turn.callTo < turn.callFrom || prior && (turn.beforeTick !== prior.afterTick || turn.beforeHash !== prior.afterHash || turn.beforeTurns !== prior.afterTurns || turn.callFrom <= prior.callTo)) throw new Error('sampled turns do not match actual ordered observations');
 }
 const used = new Set<number>();
 for (const inventory of [observation.descriptions, observation.templates]) {
  const items = inventory?.items ?? [], sequences = items.flatMap(item => item.callSequence === null ? [] : [item.callSequence]);
  if (new Set(items.map(item => item.sourceSha256)).size !== items.length || sequences.some((sequence, index) => used.has(sequence) || index > 0 && sequence <= sequences[index - 1]!)) throw new Error('named text sources and classifier sequences must be unique and ordered');
  for (const sequence of sequences) used.add(sequence);
 }
 return observation;
}
/** ew.studio.prompt.v1 hashes actual system/message words, without payer/model/capacity metadata. */
export function studioSamplingPrompt(request: { system?: string; messages: readonly { role: 'user' | 'assistant'; content: string }[] }): string {
 return JSON.stringify({ system: request.system ?? null, messages: request.messages.map(({ role, content }) => ({ role, content })) });
}
