import {expect,it} from 'vitest';
import {SelectedEngine,selectedEnginePath} from '../src/engine-selection.js';
import {studioSavedInput} from '../src/studio-validation.js';
const selected={ref:'@ironwrit/salt-harbor',versionId:'exact-engine-version',treeSha256:'a'.repeat(64),interfaceSha256:'b'.repeat(64),module:'dist/engine.js',calls:['load','save','read','query','explain','forecast','change'] as const,forecasts:false,studioValidation:'dist/studio-validation.js'};
it('retains explicit no-forecast capability independently of the answered forecast call',()=>{
 const engine=SelectedEngine.parse(selected);expect(engine.calls).toContain('forecast');expect(engine.forecasts).toBe(false);expect(selectedEnginePath(engine)).toBe('/uses/@ironwrit/salt-harbor/dist/engine.js');
 expect(selectedEnginePath(engine,'studioValidation')).toBe('/uses/@ironwrit/salt-harbor/dist/studio-validation.js');expect(()=>selectedEnginePath(engine,'studioScenario')).toThrow();
 for(const module of['../engine.js','/engine.js','dist/%2e%2e/engine.js','dist/engine.js?other','dist\\engine.js'])expect(SelectedEngine.safeParse({...selected,module}).success).toBe(false);
});
it('carries a cloned selected engine through own-byte selection without granting dependency bytes',()=>{
 const engine=SelectedEngine.parse(selected),input={snapshot:{versionId:'own-save',treeSha256:'c'.repeat(64)},manifest:{},paths:['state/engine.json'],files:new Map([['state/engine.json',new Uint8Array([1])]]),selectedEngine:engine};
 const scoped=studioSavedInput({module:'dist/validation.js',reads:['state/']},input);engine.module='dist/changed.js';
 expect(scoped.selectedEngine?.module).toBe('dist/engine.js');expect([...scoped.files.keys()]).toEqual(['state/engine.json']);expect(scoped.selectedEngine?.versionId).toBe(selected.versionId);
 expect(studioSavedInput({module:'dist/validation.js',reads:[]},{...input,selectedEngine:undefined}).selectedEngine).toBeUndefined();
});
