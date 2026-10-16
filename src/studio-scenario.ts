/** S8.3: named actual tool recipes over copied saved state, without a semantic pass claim. */
import { z } from 'zod';
import { StudioValidationDeclaration, studioSavedInput, type StudioSavedInput } from './studio-validation.js';
const Count = z.number().int().nonnegative().safe(), Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Scalar = z.union([z.number().finite(), z.string(), z.boolean(), z.null()]);
export const StudioScenarioExpectation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tick_equals'), expected: Count }).strict(),
  z.object({ kind: z.literal('variable_equals'), id: z.string().min(1), expected: Scalar }).strict(),
]);
export type StudioScenarioExpectation = z.infer<typeof StudioScenarioExpectation>;
export const StudioScenarioAssertions = z.object({
  state: z.enum(['pass', 'fail', 'unavailable', 'unperformed']),
  checks: z.array(z.object({ index: Count, expectation: StudioScenarioExpectation, state: z.enum(['pass', 'fail', 'unavailable']), found: z.boolean(), actual: Scalar, detail: z.string().min(1).max(500) }).strict()),
}).strict().superRefine((assertions, ctx) => {
  const expectedState = !assertions.checks.length ? 'unperformed' : assertions.checks.some(check => check.state === 'fail') ? 'fail' : assertions.checks.some(check => check.state === 'unavailable') ? 'unavailable' : 'pass';
  if (assertions.state !== expectedState) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'assertions retain actual checked outcomes without a vacuous pass' });
  assertions.checks.forEach((check, index) => {
    if (check.index !== index || !check.found && check.actual !== null || check.state !== 'unavailable' && (check.state === 'pass') !== (check.found && check.actual === check.expectation.expected)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'assertion outcomes match actual scalar equality' });
  });
});
export const StudioScenarioAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('advance'), ticks: Count.refine(value => value > 0) }).strict(),
  z.object({ kind: z.literal('set_variable'), id: z.string().min(1), value: z.union([z.number().finite(), z.string(), z.boolean(), z.null()]) }).strict(),
]);
export type StudioScenarioAction = z.infer<typeof StudioScenarioAction>;
export const StudioScenarioDeclaration = StudioValidationDeclaration.extend({ actions: z.array(z.enum(['advance', 'set_variable'])).min(1).refine(actions => new Set(actions).size === actions.length), expectations: z.array(z.enum(['tick_equals', 'variable_equals'])).refine(kinds => new Set(kinds).size === kinds.length).optional() }).strict();
export type StudioScenarioDeclaration = z.infer<typeof StudioScenarioDeclaration>;
export interface StudioScenarioInput extends StudioSavedInput { readonly actions: readonly StudioScenarioAction[]; readonly expectations?: readonly StudioScenarioExpectation[] }
export const StudioScenarioResult = z.object({
  state: z.enum(['completed', 'failed', 'unavailable']), detail: z.string().min(1).max(500),
  initialTick: Count.nullable(), finalTick: Count.nullable(), initialHash: Hash.nullable(), finalHash: Hash.nullable(),
  steps: z.array(z.object({ index: Count, action: StudioScenarioAction, state: z.enum(['completed', 'failed', 'unavailable']), beforeTick: Count, afterTick: Count, beforeHash: Hash, afterHash: Hash, detail: z.string().min(1).max(500) }).strict()),
  numericChanges: z.array(z.object({ id: z.string().min(1), before: z.number().finite(), after: z.number().finite() }).strict()),
  assertions: StudioScenarioAssertions.optional(),
  modelCalls: z.literal(0), turns: z.literal(0), classifier: z.literal('unperformed'),
}).strict().superRefine((result, ctx) => {
  const absent = result.initialTick === null;
  if (result.state === 'completed' && result.assertions && !['pass', 'unperformed'].includes(result.assertions.state) || result.assertions?.checks.some(check => check.expectation.kind === 'tick_equals' && check.state !== 'unavailable' && (!check.found || check.actual !== result.finalTick))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'assertion evidence matches the final state and overall outcome' });
  if ([result.finalTick, result.initialHash, result.finalHash].some(value => (value === null) !== absent) || absent && (result.steps.length || result.numericChanges.length || result.state === 'completed')) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a scenario records actual loaded state or no execution' });
  if (new Set(result.numericChanges.map(change => change.id)).size !== result.numericChanges.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'numeric changes are unique' });
  result.steps.forEach((step, index) => {
    const prior = result.steps[index - 1];
    if (step.index !== index || step.beforeTick !== (prior?.afterTick ?? result.initialTick) || step.beforeHash !== (prior?.afterHash ?? result.initialHash) || index < result.steps.length - 1 && step.state !== 'completed') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'scenario steps are contiguous actual outcomes' });
    if (step.state === 'completed' && step.afterTick - step.beforeTick !== (step.action.kind === 'advance' ? step.action.ticks : 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'completed tools have their actual tick delta' });
  });
  if (!absent && !result.steps.length && (result.initialTick !== result.finalTick || result.initialHash !== result.finalHash)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'no executed tool cannot change trial state' });
  const last = result.steps.at(-1);
  if (last && (last.afterTick !== result.finalTick || last.afterHash !== result.finalHash)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'final state matches the actual last tool' });
});
export type StudioScenarioResult = z.infer<typeof StudioScenarioResult>;
export function studioScenarioInput(declaration: StudioScenarioDeclaration, input: StudioScenarioInput): StudioScenarioInput {
  const declared = StudioScenarioDeclaration.parse(declaration), actions = z.array(StudioScenarioAction).min(1).parse(input.actions);
  if (actions.some(action => !declared.actions.includes(action.kind))) throw new Error('this scenario tool is unavailable');
  const expectations = z.array(StudioScenarioExpectation).parse(input.expectations ?? []);
  if (expectations.some(expectation => !declared.expectations?.includes(expectation.kind))) throw new Error('this scenario expectation is unavailable');
  return { ...studioSavedInput({ module: declared.module, reads: declared.reads }, input), actions, ...(expectations.length ? { expectations } : {}) };
}
export function checkedStudioScenario(value: unknown, rawActions: readonly StudioScenarioAction[], rawExpectations: readonly StudioScenarioExpectation[] = []): StudioScenarioResult {
  const actions = z.array(StudioScenarioAction).min(1).parse(rawActions), result = StudioScenarioResult.parse(value);
  if (result.steps.length > actions.length || result.steps.some((step, index) => JSON.stringify(step.action) !== JSON.stringify(actions[index])) || result.state === 'completed' && (result.steps.length !== actions.length || result.steps.some(step => step.state !== 'completed'))) throw new Error('scenario result does not match the exact recipe');
  const expectations = z.array(StudioScenarioExpectation).parse(rawExpectations), assertions = result.assertions;
  if (expectations.length && (!assertions || assertions.checks.length !== expectations.length || assertions.checks.some((check, index) => JSON.stringify(check.expectation) !== JSON.stringify(expectations[index])) || assertions.state === 'unperformed') || !expectations.length && assertions && (assertions.state !== 'unperformed' || assertions.checks.length)) throw new Error('scenario assertions do not match the exact authored expectations');
  if (assertions?.checks.some(check => check.state !== 'unavailable') && (result.steps.length !== actions.length || result.steps.some(step => step.state !== 'completed'))) throw new Error('assertions require the completed exact recipe');
  if (assertions?.state === 'fail' && result.state !== 'failed') throw new Error('failed assertions require a failed scenario');
  return result;
}
/** Tools without an input/model port cannot claim interactive or classifier work. */
export const studioScenarioUnperformed = () => ({ modelCalls: 0, turns: 0, classifier: 'unperformed' } as const);

/** Inability to execute never becomes a missing-variable assertion failure. */
export function studioScenarioAssertionsUnavailable(expectations: readonly StudioScenarioExpectation[] = []) {
  return { state: expectations.length ? 'unavailable' as const : 'unperformed' as const, checks: expectations.map((expectation, index) => ({ index, expectation, state: 'unavailable' as const, found: false, actual: null, detail: 'The complete recipe did not execute, so this expectation was not checked.' })) };
}
