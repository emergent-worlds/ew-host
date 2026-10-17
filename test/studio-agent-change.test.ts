import { expect,it } from 'vitest';
import { checkedStudioSampling,studioSamplingAgentChanges,StudioSamplingAgentChangeObservation } from '../src/studio-sampling.js';
const hash='a'.repeat(64),changed='b'.repeat(64),input='c'.repeat(64);
const action={id:'tide',text:'Change the tide.',decision:'do it' as const,undo:true,expectations:[{kind:'variable_equals' as const,id:'tide',expected:17}]};
const observation={id:'tide',inputSha256:input,callFrom:1,callTo:6,state:'completed' as const,readCalls:1,successfulReads:1,proposal:'p1',decision:'c1',choice:'do it' as const,undoRequested:true,approved:true,barriers:1,applied:true,undone:true,before:{tick:2,hash},after:{tick:2,hash:changed},restored:{tick:2,hash},assertions:{state:'pass' as const,checks:[{index:0,expectation:action.expectations[0]!,state:'pass' as const,found:true,actual:17,detail:'Actual value checked.'}]}};
const envelope=(row:unknown)=>({state:'unavailable',detail:'A disposable transaction, not full acceptance.',agentChanges:[row]});
it('retains exact authored diagnostic actions without creating live approvals',()=>{
 expect(studioSamplingAgentChanges({name:'Salt Harbor',turns:[{id:'turn',input:'look'}]})).toEqual([]);
 expect(studioSamplingAgentChanges({name:'Salt Harbor',setup:{agentChanges:[action]},turns:[{id:'turn',input:'look'}]})).toEqual([action]);
 for(const actions of [[action,action],[{...action,decision:'yes'}],[{...action,payer:'other'}],[{...action,undo:undefined}],[{...action,expectations:[{kind:'script',code:'apply()'}]}]])expect(()=>studioSamplingAgentChanges({name:'Salt Harbor',setup:{agentChanges:actions},turns:[{id:'turn',input:'look'}]})).toThrow();
});
it('validates actual matching approval/barrier/application/undo and authored predicate identity',()=>{
 const expected=[{...action,inputSha256:input}];expect(checkedStudioSampling(envelope(observation),20,[],[],expected).agentChanges).toHaveLength(1);
 for(const value of [{...observation,approved:false},{...observation,barriers:0},{...observation,undone:false},{...observation,restored:{tick:2,hash:changed}},{...observation,after:observation.before},{...observation,assertions:{state:'unperformed',checks:[]}}])expect(()=>StudioSamplingAgentChangeObservation.parse(value)).toThrow();
 for(const expectedAction of [{...action,inputSha256:hash},{...action,inputSha256:input,undo:false},{...action,inputSha256:input,expectations:[{kind:'variable_equals' as const,id:'tide',expected:99}]}])expect(()=>checkedStudioSampling(envelope(observation),20,[],[],[expectedAction])).toThrow();
 expect(()=>checkedStudioSampling(envelope(observation),20,[])).toThrow();
});
it('retains decline plus authored undo as unchanged with no undo invocation',()=>{
 const declined={...observation,choice:'never mind',approved:false,barriers:0,applied:false,undone:false,after:observation.before,restored:null,assertions:{state:'unperformed',checks:[]}};
 expect(StudioSamplingAgentChangeObservation.parse(declined).undone).toBe(false);
 expect(()=>StudioSamplingAgentChangeObservation.parse({...declined,after:observation.after})).toThrow();
});
it('refuses reused spans or actions appearing before the prior question completed',()=>{
 const question={id:'why',inputSha256:hash,callFrom:1,callTo:4,state:'completed',readCalls:1,successfulReads:1};
 expect(()=>checkedStudioSampling({...envelope(observation),agentQuestions:[question]},20,[],[{id:'why',inputSha256:hash}],[{...action,inputSha256:input}])).toThrow();
 const second={...observation,id:'other'};expect(()=>checkedStudioSampling({...envelope(observation),agentChanges:[observation,second]},20,[],[],[{...action,inputSha256:input},{...action,id:'other',inputSha256:input}])).toThrow();
});

it('retains optional named invariant facilities and refuses contradictory change read evidence',()=>{
 const facilities={interfaceSha256:hash,items:[{facility:'read',calls:1,successfulCalls:1,state:'completed'}]};expect(StudioSamplingAgentChangeObservation.parse({...observation,facilities}).facilities).toEqual(facilities);
 for(const item of [{facility:'read',calls:2,successfulCalls:1,state:'unavailable'},{facility:'read',calls:1,successfulCalls:0,state:'failed'},{facility:'read',calls:0,successfulCalls:0,state:'unavailable'}])expect(()=>StudioSamplingAgentChangeObservation.parse({...observation,facilities:{...facilities,items:[item]}})).toThrow();
 expect(StudioSamplingAgentChangeObservation.parse({...observation,state:'failed',successfulReads:0,facilities:{...facilities,items:[{facility:'read',calls:1,successfulCalls:0,state:'failed'}]}}).state).toBe('failed');
});
