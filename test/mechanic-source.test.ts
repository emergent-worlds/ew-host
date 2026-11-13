import { describe, expect, it } from 'vitest';
import { mechanicSourceReader, mechanicTreeHash, mechanicSourcesInState, type MechanicModule } from '../src/mechanic-source.js';
import { sha256 } from '../src/sha256.js';
import { endpointSends } from '../src/endpoints.js';
import { FolderMessage } from '../src/protocol.js';
import { studioSavedInput } from '../src/studio-validation.js';

const bytes = new Uint8Array([0,97,115,109,1,0,0,0]), files = [{path:'parcels.wasm',sha256:sha256(bytes),size:bytes.length}];
const module: MechanicModule = {ref:'@mercerpress/parcels',version:'1.0.0',versionId:'module-v1',treeSha256:mechanicTreeHash(files),kind:'module',files};
const source = {...module,path:'parcels.wasm',sha256:sha256(bytes)};
const request = {ref:source.ref,version:source.version,versionId:source.versionId,treeSha256:source.treeSha256,path:source.path,sha256:source.sha256};
describe('exact selected wasm source adapter', () => {
  it('reads original bytes from only the exact selected ref/version/tree/path/hash and copies them', async () => {
    const catalog = [{...module,files:[...files]}]; let calls = 0;
    const read = mechanicSourceReader(catalog,async received => {expect(received).toEqual(request);calls++;return bytes;});
    catalog[0]!.versionId='changed';
    const result = await read(request); expect(result.source).toEqual(request); expect(result.bytes).toEqual(bytes); expect(result.bytes).not.toBe(bytes); expect(calls).toBe(1);
    for (const patch of [{ref:'@ironwrit/other'}, {version:'1.0.1'}, {versionId:'module-v2'}, {treeSha256:'f'.repeat(64)}, {path:'absent.wasm'}, {sha256:'f'.repeat(64)}, {path:'../private.wasm'}, {path:'/private.wasm'}, {path:'uses/@ironwrit/x.wasm'}]) await expect(read({...request,...patch})).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it('canonicalizes ordinary ref/path input only from the selected immutable snapshot', async () => {
    let calls=0;
    const read=mechanicSourceReader([module],async()=>{calls++;return bytes;});
    expect((await read({ref:request.ref,path:request.path})).source).toEqual(request);
    expect((await read({ref:request.ref,path:request.path,sha256:request.sha256})).source).toEqual(request);
    for(const patch of [{ref:'@ironwrit/other'},{path:'missing.wasm'},{sha256:'f'.repeat(64)},{versionId:'invented'}])await expect(read({ref:request.ref,path:request.path,...patch})).rejects.toThrow();
    expect(calls).toBe(2);
  });
  it('refuses corrupt bytes, nonmodules and a corrupt or ambiguous selected tree', async () => {
    await expect(mechanicSourceReader([module],async()=>new Uint8Array([9]))(request)).rejects.toThrow(/bytes/);
    for (const modules of [[{...module,kind:'pack'}],[module,module],[{...module,files:[]}],[{...module,files:[...files,...files]}]]) await expect(mechanicSourceReader(modules,async()=>bytes)(request)).rejects.toThrow();
  });
  it('is a strict private-core request and leaves file.read own-only', () => {
    const message = {ew:1,id:1,type:'mechanic.read',source:request}; expect(FolderMessage.parse(message)).toEqual(message);
    expect(FolderMessage.safeParse({...message,source:{...request,ambient:'/secret'}}).success).toBe(false);
    expect(endpointSends('core','mechanic.read')).toBe(true); expect(endpointSends('page','mechanic.read')).toBe(false); expect(endpointSends('combined','mechanic.read')).toBe(false);
  });
  it('copies only declared source bytes into disposable saved inputs, without changing own inventory', () => {
    const saved = new Map([['state/mechanics/parcels.json',new TextEncoder().encode(JSON.stringify({body:'wasm',wasm:{path:request.path,sha256:request.sha256,module:{ref:request.ref,version:request.version,versionId:request.versionId,treeSha256:request.treeSha256}}}))]]);
    expect(mechanicSourcesInState(saved)).toEqual([request]);
    const input = {snapshot:{versionId:'own-v1',treeSha256:'a'.repeat(64)},manifest:{},paths:[...saved.keys()],files:saved,uses:[{ref:module.ref,version:module.version,kind:'module'}],mechanicSources:[{source:request,bytes}]};
    const selected = studioSavedInput({module:'validator.js',reads:['state/']},input);
    expect(selected.paths).toEqual(input.paths); expect(selected.mechanicSources?.[0]?.bytes).toEqual(bytes); expect(selected.mechanicSources?.[0]?.bytes).not.toBe(bytes);
    expect(()=>studioSavedInput({module:'validator.js',reads:['state/']},{...input,uses:[]})).toThrow();
  });
});
