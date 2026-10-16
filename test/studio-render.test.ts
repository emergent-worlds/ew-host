import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { Manifest } from '../src/manifest.js';
import { EngineInterface, FolderContract } from '../src/interface.js';
import { studioRenderInput, type StudioRenderInput } from '../src/studio-render.js';
const declaration = { module: 'dist/studio-render.js', reads: ['state/', 'np/reality.json'] };
const fixture = (): StudioRenderInput => ({ snapshot: { versionId: 'saved', treeSha256: 'a'.repeat(64) }, manifest: Manifest.parse({ name: 'Salt Harbor', kind: 'reality', version: '1.0.0', owner: '@mercerpress' }), paths: ['state/engine.json', 'private.txt'], files: new Map([['state/engine.json', new Uint8Array([1, 2])], ['private.txt', new Uint8Array([3])]]), display: { theme: 'dark', textSize: 'default', contrast: 'default', motion: 'reduced', language: 'en' } });
it('declares a separate optional renderer without converting web/play entries', () => {
  expect(FolderContract.parse({ studioRender: declaration }).studioRender).toEqual(declaration); expect(EngineInterface.parse({ calls: ['read'], studioRender: declaration }).studioRender).toEqual(declaration); expect(FolderContract.parse({}).studioRender).toBeUndefined();
  for (const module of ['../entry.js', '/play.js', 'dist/run.js?x']) expect(() => FolderContract.parse({ studioRender: { ...declaration, module } })).toThrow();
});
it('clones only selected own bytes and display data without carrying extra runtime authority', () => {
  const source = fixture(), selected = studioRenderInput(declaration, { ...source, hiddenPort: 'not an input' } as StudioRenderInput);
  expect([...selected.files.keys()]).toEqual(['state/engine.json']); expect(Object.keys(selected).sort()).toEqual(['display', 'files', 'manifest', 'paths', 'snapshot']);
  selected.files.get('state/engine.json')![0] = 99; selected.display.theme = 'light'; expect(source.files.get('state/engine.json')![0]).toBe(1); expect(source.display.theme).toBe('dark');
});
it('refuses missing selected bytes, unsafe inventory and case collisions', () => {
  const source = fixture(); expect(() => studioRenderInput(declaration, { ...source, files: new Map() })).toThrow();
  for (const paths of [['../private.txt'], ['uses/@mercerpress/private/file'], ['state/a', 'STATE/a']]) expect(() => studioRenderInput(declaration, { ...source, paths })).toThrow();
});

it('accepts actual byte arrays from another frame realm without accepting other typed views', () => {
  const input = fixture(), bytes = runInNewContext('new Uint8Array([4,5])') as Uint8Array;
  expect(studioRenderInput(declaration, { ...input, files: new Map([['state/engine.json', bytes]]) }).files.get('state/engine.json')).toEqual(new Uint8Array([4, 5]));
  expect(() => studioRenderInput(declaration, { ...input, files: new Map([['state/engine.json', new Int8Array([4]) as unknown as Uint8Array]]) })).toThrow();
});
