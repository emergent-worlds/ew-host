/** Trusted host-selected engine metadata. Identity and access are established by the caller. */
import {z} from 'zod';
import {FolderRef} from './manifest.js';
import {EngineCall} from './engine-call.js';
import {portablePath} from './builds.js';
const path=z.string().min(1).refine(value=>portablePath(value)&&!/[\u0000-\u001f%?#]/.test(value));
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const SelectedEngine=z.object({ref:FolderRef,versionId:z.string().min(1),treeSha256:hash,interfaceSha256:hash,module:path,
 calls:z.array(EngineCall).min(1),forecasts:z.boolean(),studioValidation:path.optional(),studioScenario:path.optional(),studioRender:path.optional()}).strict();
export type SelectedEngine=z.infer<typeof SelectedEngine>;
/** Import paths remain inside the exact host-mounted dependency namespace. */
export function selectedEnginePath(selection:SelectedEngine,facility:'module'|'studioValidation'|'studioScenario'|'studioRender'='module'):string {
 const checked=SelectedEngine.parse(selection),module=checked[facility];if(!module)throw Error(`the selected engine has no ${facility}`);
 return `/uses/${checked.ref}/${module}`;
}
