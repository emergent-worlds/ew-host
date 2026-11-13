/** Trusted exact component execution selection. It confers no source access. */
import {z} from 'zod';
import {FolderRef} from './manifest.js';
import {portablePath} from './builds.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/),path=z.string().min(1).refine(value=>portablePath(value)&&!/[\u0000-\u001f%?#]/.test(value));
export const ComponentSlot=z.enum(['dashboard-line','variable-course','portrait','icon','map-view','graph-view','settings-section','scene-picture','artifact-item']);
export const SelectedComponent=z.object({ref:FolderRef,versionId:z.string().min(1),treeSha256:hash,contractSha256:hash,module:path}).strict();
export const SelectedComponents=z.object({format:z.literal('ew.selected-components.v1'),bindingDigest:hash,
 engine:FolderRef.nullable(),entry:z.object({ref:FolderRef.nullable(),web:path.nullable(),headless:path.nullable()}).strict(),
 slots:z.record(ComponentSlot,z.array(SelectedComponent).min(1))}).strict();
export type SelectedComponents=z.infer<typeof SelectedComponents>;

/** A bound context cannot be silently lost in a mapper or bootstrap. Legacy absence remains valid. */
export function componentExecution(input:{componentBindingDigest?:string;selectedComponents?:unknown;selectedEngine?:{ref:string};uses?:readonly {ref:string;kind:string}[]}):SelectedComponents|undefined {
 if(input.componentBindingDigest===undefined&&input.selectedComponents===undefined)return undefined;
 const selection=SelectedComponents.parse(input.selectedComponents);
 if(input.componentBindingDigest!==selection.bindingDigest||selection.engine!==(input.selectedEngine?.ref??null))throw Error('the exact component execution binding is unavailable');
 const seen=new Map<string,string>();
 for(const [slot,modules]of Object.entries(selection.slots)){
  const refs=new Set<string>();for(const module of modules){
   if(refs.has(module.ref)||input.uses&&!input.uses.some(use=>use.ref===module.ref&&use.kind==='module'))throw Error('the exact slot dependency is unavailable');refs.add(module.ref);
   const bytes=JSON.stringify(module),prior=seen.get(module.ref);if(prior!==undefined&&prior!==bytes)throw Error('one module has contradictory exact identities');seen.set(module.ref,bytes);
  }
 }
 if(input.uses&&selection.entry.ref!==null&&!input.uses.some(use=>use.ref===selection.entry.ref))throw Error('the exact selected entry is unavailable');
 return selection;
}

/** Reported code failure of an exact selected trial; it grants no save or restoration authority. */
export const ComponentFailure=z.object({bindingDigest:hash,ref:FolderRef,phase:z.enum(['import','mount','update','startup'])}).strict();
export type ComponentFailure=z.infer<typeof ComponentFailure>;
