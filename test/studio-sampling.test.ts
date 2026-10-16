import { expect, it } from 'vitest';
import { studioSamplingInput, StudioSamplingCorpus, StudioSamplingDeclaration, studioSamplingAgentQuestions, checkedStudioSampling } from '../src/studio-sampling.js';
it('requires exact authored corpus identities and confined declaration without inventing turns', () => {
 const declaration = { module: 'dist/sample.js', reads: ['state/'], corpus: 'studio/corpus.json' };
 expect(StudioSamplingDeclaration.parse(declaration)).toEqual(declaration);
 for (const corpus of ['../outside.json', 'uses/@mercerpress/corpus.json', 'http://example.test/corpus.json']) expect(StudioSamplingDeclaration.safeParse({ ...declaration, corpus }).success).toBe(false);
 expect(StudioSamplingCorpus.parse({ name: 'Salt Harbor sample', turns: [{ id: 'look', input: 'look around' }] }).turns).toHaveLength(1);
 for (const turns of [[], [{ id: 'look' }], [{ id: 'look', input: 'look' }, { id: 'look', input: 'again' }]]) expect(StudioSamplingCorpus.safeParse({ name: 'Salt Harbor', turns }).success).toBe(false);
});
it('clones selected saved bytes, corpus setup/inputs and manifest without model or save ports', () => {
 const bytes = new Uint8Array([1]), corpus = { name: 'Salt Harbor sample', setup: { choice: 'harbormaster' }, turns: [{ id: 'look', input: { text: 'look around' } }] };
 const input = studioSamplingInput({ module: 'sample.js', reads: ['state/'], corpus: 'studio/corpus.json' }, { snapshot: { versionId: 'saved', treeSha256: 'a'.repeat(64) }, manifest: { name: 'Salt Harbor' }, paths: ['state/engine.json', 'private.txt'], files: new Map([['state/engine.json', bytes]]), corpus, requestedTurns: 20 });
 input.files.get('state/engine.json')![0] = 2; (input.corpus.setup as any).choice = 'changed'; (input.corpus.turns[0]!.input as any).text = 'changed';
 expect(bytes[0]).toBe(1); expect(corpus.setup.choice).toBe('harbormaster'); expect(corpus.turns[0]!.input.text).toBe('look around'); expect(input.requestedTurns).toBe(20); expect(input.corpus.turns).toHaveLength(1); expect(input).not.toHaveProperty('model'); expect(input).not.toHaveProperty('save');
});


it('binds read-only question observations without treating them as completed turns',()=>{
 const corpus={name:'Salt Harbor',setup:{agentQuestions:[{id:'why',text:'Why is the tide high?'}]},turns:[{id:'look',input:'look'}]};expect(studioSamplingAgentQuestions(corpus)).toEqual(corpus.setup.agentQuestions);
 const question={id:'why',inputSha256:'a'.repeat(64),callFrom:1,callTo:4,state:'completed',readCalls:1,successfulReads:1},observation={state:'unavailable',detail:'Question evidence only.',agentQuestions:[question]};
 expect(checkedStudioSampling(observation,20,[],[{id:'why',inputSha256:'a'.repeat(64)}]).turns).toBeUndefined();
 for(const bad of [{...question,successfulReads:0},{...question,callTo:0},{...question,id:'other'}])expect(()=>checkedStudioSampling({...observation,agentQuestions:[bad]},20,[],[{id:'why',inputSha256:'a'.repeat(64)}])).toThrow();
 expect(()=>studioSamplingAgentQuestions({...corpus,setup:{agentQuestions:[...corpus.setup.agentQuestions,...corpus.setup.agentQuestions]}})).toThrow();
});
