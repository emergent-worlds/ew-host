import { expect, it } from 'vitest';
import { checkedStudioScenario, studioScenarioInput, StudioScenarioDeclaration } from '../src/studio-scenario.js';
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
