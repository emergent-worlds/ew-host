import { expect, it } from 'vitest';
import { checkedStudioSampling } from '../src/studio-sampling.js';
const hash = '0'.repeat(64), next = '1'.repeat(64), authored = [{ id: 'look', inputSha256: hash }, { id: 'listen', inputSha256: next }];
const first = { id: 'look', inputSha256: hash, beforeTick: 0, afterTick: 1, beforeHash: hash, afterHash: next, beforeTurns: 0, afterTurns: 1, callFrom: 1, callTo: 2 };
const second = { ...first, id: 'listen', inputSha256: next, beforeTick: 1, afterTick: 2, beforeHash: next, beforeTurns: 1, afterTurns: 2, callFrom: 3, callTo: 4 };
it('checks authored prefix, counter/hash/tick continuity and distinct admitted call spans without a clean flag', () => {
 const value = { state: 'unavailable', detail: 'Other coverage remains unavailable.', turns: [first, second] };
 expect(checkedStudioSampling(value, 20, authored).turns).toHaveLength(2);
 for (const change of [{ id: 'invented' }, { inputSha256: hash }, { beforeTick: 0 }, { beforeHash: hash }, { afterTurns: 1 }, { callFrom: 2 }, { callTo: 1 }]) expect(() => checkedStudioSampling({ ...value, turns: [first, { ...second, ...change }] }, 20, authored)).toThrow();
 expect(() => checkedStudioSampling(value, 1, authored)).toThrow(); expect(() => checkedStudioSampling({ ...value, clean: true }, 20, authored)).toThrow();
});
