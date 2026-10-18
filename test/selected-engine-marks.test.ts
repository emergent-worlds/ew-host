import {expect,it} from 'vitest';
import {EngineInterface,FolderContract,Manifest,markFolder,type Catalog} from '../src/index.js';
it('checks a selected direct fork against pack needs while retaining an interfaced transitive base engine',()=>{
 const base='@emergentworlds/emergence-engine',fork='@salt_and_ash/engine',pack='@emergentworlds/narrative-protagonist';
 const manifests=new Map([[base,Manifest.parse({name:'emergence-engine',owner:'@emergentworlds',version:'1.0.0',kind:'engine'})],[fork,Manifest.parse({name:'engine',owner:'@salt_and_ash',version:'1.0.0',kind:'engine'})],[pack,Manifest.parse({name:'narrative-protagonist',owner:'@emergentworlds',version:'1.0.0',kind:'pack',uses:{[base]:'^1'},entry:{web:'index.html'}})]]);
 const reality=Manifest.parse({name:'salt-harbor',owner:'@salt_and_ash',version:'1.0.0',kind:'reality',uses:{[pack]:'^1',[fork]:'^1'}}),iface=EngineInterface.parse({calls:['load','read','change','forecast'],forecasts:false,state:['variables']}),contract=FolderContract.parse({needs:{calls:['read','change','forecast'],state:['variables']}});
 const catalog:Catalog={versions:ref=>manifests.has(ref)?['1.0.0']:[],manifest:ref=>manifests.get(ref),engineInterface:ref=>[base,fork].includes(ref)?iface:undefined,contract:ref=>ref===pack?contract:undefined};
 expect(markFolder(reality,catalog,'computer',fork).mark).toBe('works');
 expect(markFolder(reality,{...catalog,engineInterface:ref=>ref===fork?{...iface,calls:['read']}:iface},'computer',fork)).toMatchObject({mark:"won't work"});
 expect(markFolder(reality,{...catalog,engineInterface:ref=>ref===base?undefined:iface},'computer',fork).mark).toBe('may work');
});
