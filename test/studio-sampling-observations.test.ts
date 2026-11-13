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
it('rejects reused description identities or classifier work and hashes the actual ordered prompt words', async () => {
 const { studioSamplingPrompt } = await import('../src/studio-sampling.js');
 const item={sourceSha256:hash,textSha256:next,callSequence:1}, result={state:'unavailable',detail:'Named inventory only.',descriptions:{scope:'fixture.saved-descriptions.v1',items:[item]}};
 expect(checkedStudioSampling(result,20,authored).descriptions!.items).toHaveLength(1);
 expect(()=>checkedStudioSampling({...result,descriptions:{...result.descriptions,items:[item,{...item,sourceSha256:next}]}},20,authored)).toThrow();
 expect(()=>checkedStudioSampling({...result,descriptions:{...result.descriptions,items:[item,{...item,callSequence:2}]}},20,authored)).toThrow();
 expect(studioSamplingPrompt({messages:[{role:'user',content:'Salt Harbor 🌊'}]})).toBe(JSON.stringify({system:null,messages:[{role:'user',content:'Salt Harbor 🌊'}]}));
 expect(studioSamplingPrompt({system:'Actual saved instructions',messages:[{role:'user',content:'look'},{role:'assistant',content:'reply'}]})).not.toBe(studioSamplingPrompt({system:'Actual saved instructions',messages:[{role:'assistant',content:'reply'},{role:'user',content:'look'}]}));
});

it('retains a separate optional template inventory with unique ordered classifier work', () => {
 const item = { sourceSha256: hash, textSha256: next, callSequence: 1 }, value = { state: 'unavailable', detail: 'bounded', templates: { scope: 'np.prompt-templates.v1', items: [item] } };
 expect(checkedStudioSampling(value, 20, authored).templates!.items).toEqual([item]);
 for (const items of [[item, { ...item, sourceSha256: next }], [item, { ...item, callSequence: 2 }], [{ ...item, callSequence: 2 }, { ...item, sourceSha256: next, callSequence: 1 }]]) expect(() => checkedStudioSampling({ ...value, templates: { ...value.templates, items } }, 20, authored)).toThrow();
 expect(() => checkedStudioSampling({ ...value, descriptions: { scope: 'fixture.saved.v1', items: [item] } }, 20, authored)).toThrow();
});
