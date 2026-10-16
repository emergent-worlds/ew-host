import { expect, it } from 'vitest';
import { checkedStudioScenario, studioScenarioInput, StudioScenarioDeclaration, StudioScenarioSuite, STUDIO_SCENARIO_SUITE_PATH } from '../src/studio-scenario.js';
const action = { kind: 'advance' as const, ticks: 3 }, declaration = { module: 'dist/scenario.js', reads: ['state/'], actions: ['advance' as const, 'set_variable' as const] };
const result = { state: 'completed', detail: 'Actual three ticks.', initialTick: 7, finalTick: 10, initialHash: 'a'.repeat(64), finalHash: 'b'.repeat(64), steps: [{ index: 0, action, state: 'completed', beforeTick: 7, afterTick: 10, beforeHash: 'a'.repeat(64), afterHash: 'b'.repeat(64), detail: 'Three ticks.' }], numericChanges: [], modelCalls: 0, turns: 0, classifier: 'unperformed' };
it('accepts only explicit implemented tools and selects cloned saved bytes without ports', () => {
  const bytes = new Uint8Array([1]); const input = studioScenarioInput(declaration, { snapshot: { versionId: 'saved', treeSha256: 'a'.repeat(64) }, manifest: {}, paths: ['state/engine.json', 'private.txt'], files: new Map([['state/engine.json', bytes]]), actions: [action] });
  expect([...input.files.keys()]).toEqual(['state/engine.json']); input.files.get('state/engine.json')![0] = 2; expect(bytes[0]).toBe(1);
  expect(() => studioScenarioInput({ ...declaration, actions: ['advance'] }, { ...input, actions: [{ kind: 'set_variable', id: 'tide', value: 1 }] })).toThrow();
  expect(StudioScenarioDeclaration.safeParse({ ...declaration, actions: ['fire_schedule'] }).success).toBe(false);
});
it('retains counted recipe outcomes but refuses skipped, changed, invented or classifier-clean evidence', () => {
  expect(checkedStudioScenario(result, [action]).state).toBe('completed');
  for (const changed of [{ ...result, turns: 20 }, { ...result, classifier: 'clean' }, { ...result, steps: [] }, { ...result, finalTick: 11 }, { ...result, steps: [{ ...result.steps[0], action: { ...action, ticks: 2 } }] }]) expect(() => checkedStudioScenario(changed, [action])).toThrow();
  expect(checkedStudioScenario({ ...result, state: 'unavailable', detail: 'Pending model work.', steps: [{ ...result.steps[0], state: 'unavailable' }] }, [action]).state).toBe('unavailable');
});
it('requires explicitly advertised authored assertions and exact final-state outcomes', () => {
  const expectation = { kind: 'tick_equals' as const, expected: 10 };
  const assertions = { state: 'pass', checks: [{ index: 0, expectation, state: 'pass', found: true, actual: 10, detail: 'The final tick is ten.' }] };
  expect(checkedStudioScenario({ ...result, assertions }, [action], [expectation]).assertions?.state).toBe('pass');
  for (const changed of [{ ...result, assertions: { state: 'pass', checks: [] } }, { ...result, assertions: { ...assertions, checks: [{ ...assertions.checks[0], actual: 11 }] } }, result]) expect(() => checkedStudioScenario(changed, [action], [expectation])).toThrow();
  expect(() => checkedStudioScenario({ ...result, assertions }, [action])).toThrow();
  const input = { snapshot: { versionId: 'saved', treeSha256: 'a'.repeat(64) }, manifest: {}, paths: [], files: new Map(), actions: [action], expectations: [expectation] };
  expect(() => studioScenarioInput(declaration, input)).toThrow('expectation');
  expect(studioScenarioInput({ ...declaration, expectations: ['tick_equals'] }, input).expectations).toEqual([expectation]);
});
it('distinguishes missing variables from null and refuses partial-recipe assertion passes', () => {
  const expectation = { kind: 'variable_equals' as const, id: 'missing', expected: null };
  const check = { index: 0, expectation, state: 'fail', found: false, actual: null, detail: 'This variable is missing.' };
  expect(checkedStudioScenario({ ...result, state: 'failed', assertions: { state: 'fail', checks: [check] } }, [action], [expectation]).assertions?.state).toBe('fail');
  expect(() => checkedStudioScenario({ ...result, assertions: { state: 'pass', checks: [{ ...check, state: 'pass' }] } }, [action], [expectation])).toThrow();
  expect(() => checkedStudioScenario({ ...result, state: 'unavailable', steps: [{ ...result.steps[0], state: 'unavailable' }], assertions: { state: 'pass', checks: [{ ...check, state: 'pass', found: true }] } }, [action], [expectation])).toThrow();
});

it('parses only explicit named required recipes with unique opaque ids and nonempty predicates', () => {
  const recipe = { id: ' goal ', name: ' Three ticks ', actions: [action], expectations: [{ kind: 'tick_equals', expected: 10 }] };
  expect(STUDIO_SCENARIO_SUITE_PATH).toBe('studio/scenarios.json');
  const suite = StudioScenarioSuite.parse({ name: ' Salt Harbor ', scenarios: [recipe] }); expect(suite.name).toBe('Salt Harbor'); expect(suite.scenarios[0]?.id).toBe('goal');
  expect(StudioScenarioSuite.parse({ name: 'Salt Harbor', scenarios: [] }).scenarios).toEqual([]);
  for (const scenarios of [[recipe, recipe], [{ ...recipe, id: ' ' }], [{ ...recipe, id: 'x'.repeat(201) }], [{ ...recipe, name: 'x'.repeat(201) }], [{ ...recipe, actions: [] }], [{ ...recipe, expectations: [] }], [{ ...recipe, passed: true }]]) expect(StudioScenarioSuite.safeParse({ name: 'Salt Harbor', scenarios }).success).toBe(false);
  expect(StudioScenarioSuite.parse({ name: 'Salt Harbor', scenarios: [recipe, { ...recipe, id: 'Goal' }] }).scenarios).toHaveLength(2);
});
