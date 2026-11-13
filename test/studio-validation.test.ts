import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { EngineInterface, FolderContract } from '../src/interface.js';
import { checkedStudioValidation, studioValidationInput, StudioValidationDeclaration, StudioValidationResult } from '../src/studio-validation.js';
const declaration = { module: 'dist/studio-validation.js', reads: ['state/', 'np/reality.json'] };
const finding = { id: 'state.load', title: 'Loads the selected state', state: 'pass', detail: 'Loaded actual bytes.' };
const result = { checks: [finding], run: { state: 'pass', requestedTicks: 365, completedTicks: 365, initialTick: 12, finalTick: 377, detail: '365 ticks completed.' } };
it('declares optional confined validation on engine or pack without changing old contracts', () => {
  expect(EngineInterface.parse({ calls: ['load'] }).studioValidation).toBeUndefined();
  expect(EngineInterface.parse({ calls: ['load'], studioValidation: declaration }).studioValidation).toEqual(declaration);
  expect(FolderContract.parse({ studioValidation: declaration }).studioValidation).toEqual(declaration);
  for (const path of ['/state/', '../state/', 'state/../', 'state//', 'state/./', 'state\\header', 'state/%2e', 'state/header?x', 'uses/foreign/', 'USES/foreign', 'state/con']) expect(StudioValidationDeclaration.safeParse({ ...declaration, reads: [path] }).success).toBe(false);
  for (const module of ['/validate.js', '../validate.js', 'dist/validate.js#x', 'dist/validate.js?x', 'file:validate', 'dist/']) expect(StudioValidationDeclaration.safeParse({ ...declaration, module }).success).toBe(false);
  expect(StudioValidationDeclaration.safeParse({ ...declaration, reads: ['state/', 'STATE/'] }).success).toBe(false);
});
it('clones only declared exact or prefix bytes, with own inventory and no cross-folder authority', () => {
  const bytes = new Uint8Array([1, 2]), manifest = { name: 'Salt Harbor' };
  const input = { snapshot: { versionId: 'v1', treeSha256: 'a'.repeat(64) }, manifest, paths: ['state/engine.json', 'np/reality.json', 'np/reality.json.bak', 'secret.txt'], files: new Map([['state/engine.json', bytes], ['np/reality.json', bytes], ['np/reality.json.bak', bytes], ['secret.txt', bytes]]), requestedTicks: 365 };
  const selected = studioValidationInput(declaration, input);
  expect([...selected.files.keys()]).toEqual(['state/engine.json', 'np/reality.json']); expect(selected.paths).toEqual(input.paths);
  selected.files.get('state/engine.json')![0] = 99; (selected.manifest as typeof manifest).name = 'Orrery Nights'; expect(bytes[0]).toBe(1); expect(manifest.name).toBe('Salt Harbor');
  expect(() => studioValidationInput(declaration, { ...input, files: new Map() })).toThrow(); expect(() => studioValidationInput(declaration, { ...input, paths: ['state/../secret'] })).toThrow(); expect(() => studioValidationInput(declaration, { ...input, requestedTicks: 0 })).toThrow();
});
it('refuses lowered requested counts, invented ticks, malformed or duplicated evidence', () => {
  expect(checkedStudioValidation(result, 365).run.finalTick).toBe(377);
  for (const run of [{ ...result.run, requestedTicks: 1, completedTicks: 1, finalTick: 13 }, { ...result.run, completedTicks: 364 }, { ...result.run, finalTick: 378 }, { ...result.run, initialTick: null, finalTick: null }, { ...result.run, requestedTicks: Number.MAX_SAFE_INTEGER + 1 }, { ...result.run, state: 'failed' }]) expect(() => checkedStudioValidation({ ...result, run }, 365)).toThrow();
  expect(StudioValidationResult.safeParse({ ...result, checks: [] }).success).toBe(false);
  expect(StudioValidationResult.safeParse({ ...result, checks: [finding, finding] }).success).toBe(false); expect(StudioValidationResult.safeParse({ ...result, checks: [{ ...finding, account: 'secret' }] }).success).toBe(false);
});
it('retains real partial progress or no run without promoting either to a pass', () => {
  expect(checkedStudioValidation({ ...result, run: { ...result.run, state: 'fail', completedTicks: 3, finalTick: 15 } }, 365).run.state).toBe('fail');
  expect(checkedStudioValidation({ ...result, run: { ...result.run, state: 'unavailable', completedTicks: 0, initialTick: null, finalTick: null } }, 365).run.state).toBe('unavailable');
});

it('preserves verified tree identities without granting unselected bytes and refuses tampered selected metadata', () => {
 const bytes = new TextEncoder().encode('saved state'), other = new TextEncoder().encode('unselected asset'), digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
 const tree = [{path:'state/engine.json',sha256:digest(bytes),size:bytes.length},{path:'private.bin',sha256:digest(other),size:other.length}], source={snapshot:{versionId:'saved',treeSha256:'a'.repeat(64)},manifest:{},paths:tree.map(file=>file.path),files:new Map([['state/engine.json',bytes],['private.bin',other]]),tree,requestedTicks:365};
 const selected=studioValidationInput(declaration,source);expect(selected.tree).toEqual(tree);expect([...selected.files.keys()]).toEqual(['state/engine.json']);expect(selected.tree).not.toBe(tree);expect(selected.tree![0]).not.toBe(tree[0]);
 for(const invalid of [[tree[0]!], [tree[0]!,tree[0]!], [{...tree[0]!,sha256:'0'.repeat(64)},tree[1]!],[{...tree[0]!,size:bytes.length+1},tree[1]!],[tree[0]!,{...tree[1]!,path:'../private.bin'}]])expect(()=>studioValidationInput(declaration,{...source,tree:invalid})).toThrow();
});

it('preserves optional nonblocking warning diagnostics without inventing old evidence', () => {
 const warning = {id:'pack.controlled_names',title:'Visible names for player-controlled variables',state:'warn',detail:'One actual controlled variable has no visible label.'};
 expect(checkedStudioValidation(result,365).warnings).toBeUndefined();
 expect(checkedStudioValidation({...result,checks:[{...finding,state:'fail'}],warnings:[warning]},365)).toMatchObject({checks:[{state:'fail'}],warnings:[warning]});
 for(const warnings of [[warning,warning],[{...warning,id:finding.id}],[{...warning,state:'fail'}],[{...warning,extra:true}]])expect(()=>checkedStudioValidation({...result,warnings},365)).toThrow();
 for(const state of ['pass','warn','unavailable'])expect(checkedStudioValidation({...result,warnings:[{...warning,state}]},365).warnings?.[0]?.state).toBe(state);
});
