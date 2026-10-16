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
export interface StudioSamplingInput extends StudioSavedInput { readonly corpus: StudioSamplingCorpus; readonly requestedTurns: number }
/** The caller verifies the corpus's immutable path/hash before selecting these cloned data. */
export function studioSamplingInput(declaration: StudioSamplingDeclaration, input: StudioSamplingInput): StudioSamplingInput {
 const declared = StudioSamplingDeclaration.parse(declaration);
 if (!Number.isSafeInteger(input.requestedTurns) || input.requestedTurns <= 0) throw new Error('sampling requests a positive counted number of actual turns');
 return { ...studioSavedInput({ module: declared.module, reads: declared.reads }, input), corpus: structuredClone(StudioSamplingCorpus.parse(input.corpus)), requestedTurns: input.requestedTurns };
}
