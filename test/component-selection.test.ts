import {expect,it} from 'vitest';
import {Manifest} from '../src/manifest.js';
import {FolderContract} from '../src/interface.js';
import {markFolder,type Catalog} from '../src/marks.js';
import {SelectedComponents,componentExecution} from '../src/component-selection.js';
import {studioSavedInput} from '../src/studio-validation.js';
const pack='@ironwrit/salt-harbor',module='@crowsfeather/orrery-nights';
const selection=()=>SelectedComponents.parse({format:'ew.selected-components.v1',bindingDigest:'a'.repeat(64),engine:null,entry:{ref:pack,web:'page.html',headless:null},slots:{'graph-view':[{ref:module,versionId:'module-save',treeSha256:'b'.repeat(64),contractSha256:'c'.repeat(64),module:'dist/module.js'}]}});
function facts(extra:object={}){
 const p=Manifest.parse({kind:'pack',owner:'@ironwrit',name:'salt-harbor',version:'1.0.0',entry:{web:'page.html'}}),m=Manifest.parse({kind:'module',owner:'@crowsfeather',name:'orrery-nights',version:'1.0.0'}),root=Manifest.parse({kind:'reality',owner:'@mercerpress',name:'kestrel-yards',version:'1.0.0',uses:{[pack]:'^1',[module]:'^1'}});
 const c=FolderContract.parse({module:'dist/module.js',adds:{slots:['graph-view']},...extra}),pContract=FolderContract.parse({adds:{gives:['graph-view']}});
 const catalog:Catalog={versions:ref=>[pack,module].includes(ref)?['1.0.0']:[],manifest:ref=>ref===pack?p:ref===module?m:undefined,contract:ref=>ref===pack?pContract:ref===module?c:undefined,engineInterface:()=>undefined};
 return{root,catalog,pContract,p};
}
it('admits an actual engine-free entry and a declared renamed module slot',()=>{const f=facts();expect(markFolder(f.root,f.catalog,'computer',undefined,undefined,selection())).toEqual({mark:'works',reason:'everything it needs is there'});});
it('separates unknown compatibility from missing required calls',()=>{
 const fit=facts({fits:{[pack]:'^2'}});expect(markFolder(fit.root,fit.catalog,'computer',undefined,undefined,selection()).mark).toBe('may work');
 const missing=facts({needs:{calls:['read']}});expect(markFolder(missing.root,missing.catalog,'computer',undefined,undefined,selection())).toEqual({mark:"won't work",reason:`${module} needs an engine which is not selected`});
});
it('refuses a selected filler when the actual entry does not expose its slot',()=>{const f=facts();f.pContract.adds.gives=[];expect(markFolder(f.root,f.catalog,'computer',undefined,undefined,selection()).mark).toBe("won't work");});
it('keeps selected slot identities through cloned Studio input and refuses an unsafe module',()=>{
 const selected=selection(),input={snapshot:{versionId:'own-save',treeSha256:'d'.repeat(64)},manifest:{},paths:[],files:new Map(),selectedComponents:selected,componentBindingDigest:selected.bindingDigest};
 const value=studioSavedInput({module:'check.js',reads:[]},input);selected.slots['graph-view']![0]!.versionId='changed';expect(value.selectedComponents?.slots['graph-view']?.[0]?.versionId).toBe('module-save');expect(value.files.size).toBe(0);
 expect(SelectedComponents.safeParse({...selection(),slots:{'graph-view':[{...selection().slots['graph-view']![0],module:'../escape.js'}]}}).success).toBe(false);
});
it('preserves several explicitly selected fillers for repeated slots',()=>{const selected=selection();selected.slots['graph-view']!.push({...selected.slots['graph-view']![0]!,ref:'@mercerpress/kestrel-yards',versionId:'other-save'});expect(SelectedComponents.parse(selected).slots['graph-view']).toHaveLength(2);});

it('refuses a dropped or contradictory bound execution context without changing legacy absence',()=>{
 expect(componentExecution({})).toBeUndefined();
 expect(()=>componentExecution({componentBindingDigest:'a'.repeat(64)})).toThrow();
 expect(()=>componentExecution({componentBindingDigest:'d'.repeat(64),selectedComponents:selection()})).toThrow();
 expect(()=>componentExecution({componentBindingDigest:'a'.repeat(64),selectedComponents:selection(),selectedEngine:{ref:'@ironwrit/other-engine'}})).toThrow();
 expect(()=>componentExecution({componentBindingDigest:'a'.repeat(64),selectedComponents:selection(),uses:[{ref:pack,kind:'pack'}]})).toThrow();
});
