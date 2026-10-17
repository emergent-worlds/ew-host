/** PV54: exact authored sampling input; it confers no model or passing-check authority. */
import { z } from 'zod';
import { StudioScenarioExpectation, StudioScenarioAssertions } from './studio-scenario.js';
import { EngineCall } from './engine-call.js';
import { portablePath } from './builds.js';
import { studioSavedInput, StudioValidationDeclaration, type StudioSavedInput } from './studio-validation.js';
const corpusPath = z.string().min(1).max(512).refine(path => portablePath(path) && !/[%#]/.test(path) && path.split('/')[0]!.toLowerCase() !== 'uses', 'an explicit saved own corpus path');
export const StudioSamplingDeclaration = StudioValidationDeclaration.extend({ corpus: corpusPath }).strict();
export type StudioSamplingDeclaration = z.infer<typeof StudioSamplingDeclaration>;
export const StudioSamplingCorpus = z.object({
 name: z.string().trim().min(1).max(200), setup: z.unknown().optional(),
 turns: z.array(z.object({ id: z.string().min(1).max(200), input: z.unknown() }).strict().refine(turn => Object.hasOwn(turn, 'input'), 'an authored turn has explicit input')).min(1),
}).strict().superRefine((corpus, context) => {
 if (new Set(corpus.turns.map(turn => turn.id)).size !== corpus.turns.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'authored turn identities are unique' });
});
export type StudioSamplingCorpus = z.infer<typeof StudioSamplingCorpus>;
const Count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), Hash = z.string().regex(/^[0-9a-f]{64}$/);
export const StudioSamplingEngineInterface=z.object({sha256:Hash,calls:z.array(EngineCall).min(1),forecasts:z.boolean()}).strict();
export type StudioSamplingEngineInterface=z.infer<typeof StudioSamplingEngineInterface>;
export const StudioSamplingDependency = z.object({ ref: z.string(), version: z.string(), kind: z.string(), folderId: z.string(), versionId: z.string(), treeSha256: Hash,engineInterface:StudioSamplingEngineInterface.optional() }).strict().superRefine((value,context)=>{if(value.engineInterface&&value.kind!=='engine')context.addIssue({code:z.ZodIssueCode.custom,message:'only a resolved engine carries checked interface metadata'});});
export const StudioSamplingTurn = z.object({ id: z.string(), inputSha256: Hash, beforeTick: Count, afterTick: Count, beforeHash: Hash, afterHash: Hash, beforeTurns: Count, afterTurns: Count, callFrom: Count.refine(value => value > 0), callTo: Count.refine(value => value > 0) }).strict();
export const StudioSamplingDescriptionInventory = z.object({ scope: z.string().regex(/^[a-z][a-z0-9_.-]{0,99}$/), items: z.array(z.object({ sourceSha256: Hash, textSha256: Hash, callSequence: Count.refine(value => value > 0).nullable() }).strict()) }).strict();
export const StudioSamplingDiagnostic = z.object({ownerHandle:z.string().regex(/^@[a-z0-9_]+$/),startedAt:z.string().datetime()}).strict();
export const StudioSamplingAgentQuestion = z.object({id:z.string().min(1).max(200),text:z.string().min(1).max(4000)}).strict();
/** This optional reserved setup field names non-turn questions, never approvals. */
export function studioSamplingAgentQuestions(corpus:StudioSamplingCorpus):z.infer<typeof StudioSamplingAgentQuestion>[] {
 const setup=corpus.setup;if(!setup||typeof setup!=='object'||Array.isArray(setup)||!Object.hasOwn(setup,'agentQuestions'))return[];
 const questions=z.array(StudioSamplingAgentQuestion).parse((setup as {agentQuestions?:unknown}).agentQuestions);
 if(new Set(questions.map(question=>question.id)).size!==questions.length)throw new Error('authored agent question identities are unique');return questions;
}
export const StudioSamplingAgentChangeAction=z.object({id:z.string().min(1).max(200),text:z.string().trim().min(1).max(4000),decision:z.enum(['do it','never mind']),undo:z.boolean(),expectations:z.array(StudioScenarioExpectation)}).strict();
export type StudioSamplingAgentChangeAction=z.infer<typeof StudioSamplingAgentChangeAction>;
export function studioSamplingAgentChanges(corpus:StudioSamplingCorpus):StudioSamplingAgentChangeAction[]{
 const setup=corpus.setup;if(!setup||typeof setup!=='object'||Array.isArray(setup)||!Object.hasOwn(setup,'agentChanges'))return[];
 const actions=z.array(StudioSamplingAgentChangeAction).parse((setup as {agentChanges?:unknown}).agentChanges);
 if(new Set(actions.map(action=>action.id)).size!==actions.length)throw new Error('authored agent change identities are unique');return actions;
}
export const StudioSamplingAgentFacility=z.object({facility:z.enum(['read','query','explain','forecast']),calls:Count,successfulCalls:Count,state:z.enum(['completed','failed','unavailable'])}).strict().superRefine((value,context)=>{if(value.successfulCalls>value.calls||value.state==='completed'&&(!value.calls||value.successfulCalls!==value.calls))context.addIssue({code:z.ZodIssueCode.custom,message:'facility completion requires actual successful handler calls'});});
export const StudioSamplingAgentFacilities=z.object({interfaceSha256:Hash.nullable(),items:z.array(StudioSamplingAgentFacility)}).strict().superRefine((value,context)=>{if(new Set(value.items.map(item=>item.facility)).size!==value.items.length||value.items.some(item=>item.facility==='forecast'&&item.state==='completed')&&value.interfaceSha256===null)context.addIssue({code:z.ZodIssueCode.custom,message:'named facilities are unique and a forecast binds its checked interface'});});
export type StudioSamplingAgentFacilities=z.infer<typeof StudioSamplingAgentFacilities>;
const ChangeState=z.object({tick:Count,hash:Hash}).strict();
export const StudioSamplingAgentChangeObservation=z.object({id:z.string(),inputSha256:Hash,callFrom:Count.refine(n=>n>0).nullable(),callTo:Count.refine(n=>n>0).nullable(),state:z.enum(['completed','failed','unavailable']),readCalls:Count,successfulReads:Count,proposal:z.string().nullable(),decision:z.string().nullable(),choice:z.enum(['do it','never mind']),undoRequested:z.boolean(),approved:z.boolean(),barriers:Count,applied:z.boolean(),undone:z.boolean(),before:ChangeState.nullable(),after:ChangeState.nullable(),restored:ChangeState.nullable(),assertions:StudioScenarioAssertions,facilities:StudioSamplingAgentFacilities.optional()}).strict().superRefine((value,context)=>{
 if(value.successfulReads>value.readCalls||(value.callFrom===null)!==(value.callTo===null)||value.callFrom!==null&&value.callTo!<value.callFrom||value.undone&&(!value.undoRequested||!value.applied)||value.applied&&!value.approved)context.addIssue({code:z.ZodIssueCode.custom,message:'change observations retain coherent actual transaction outcomes'});
 const facilities=value.facilities;if(facilities&&(facilities.items.reduce((sum,item)=>sum+item.calls,0)!==value.readCalls||facilities.items.reduce((sum,item)=>sum+item.successfulCalls,0)!==value.successfulReads||value.state==='completed'&&facilities.items.some(item=>item.state!=='completed')))context.addIssue({code:z.ZodIssueCode.custom,message:'change facilities retain coherent actual read counts and outcomes'});
 if(value.state!=='completed')return;
 if(!value.proposal||!value.decision||value.callFrom===null||!value.before||!value.after||value.choice==='never mind'&&(value.approved||value.applied||value.undone||value.barriers!==0||JSON.stringify(value.before)!==JSON.stringify(value.after))||value.choice==='do it'&&(!value.approved||!value.applied||value.barriers!==1||value.before.hash===value.after.hash||value.before.tick!==value.after.tick||value.assertions.state!=='pass'||!value.assertions.checks.length||value.undoRequested&&(!value.undone||JSON.stringify(value.restored)!==JSON.stringify(value.before))))context.addIssue({code:z.ZodIssueCode.custom,message:'completed changes require actual bound approval/barrier/apply/readback and any authored undo'});
});
export const StudioSamplingAgentObservation = z.object({id:z.string(),inputSha256:Hash,callFrom:Count.refine(n=>n>0).nullable(),callTo:Count.refine(n=>n>0).nullable(),state:z.enum(['completed','failed','unavailable']),readCalls:Count,successfulReads:Count,facilities:StudioSamplingAgentFacilities.optional()}).strict().superRefine((value,ctx)=>{
 if(value.successfulReads>value.readCalls||(value.callFrom===null)!==(value.callTo===null)||value.callFrom!==null&&value.callTo!<value.callFrom||value.state==='completed'&&(!value.successfulReads||value.successfulReads!==value.readCalls||value.callFrom===null))ctx.addIssue({code:z.ZodIssueCode.custom,message:'agent question observations require actual read work and a coherent call span'});
});
export const StudioSamplingRouteObservation = z.object({id:z.string(),inputSha256:Hash,callFrom:Count.refine(n=>n>0).nullable(),callTo:Count.refine(n=>n>0).nullable(),state:z.enum(['completed','failed','unavailable']),winner:z.enum(['reply','deadline','refused','cancelled']),decision:z.enum(['turn','change']).nullable()}).strict().superRefine((value,ctx)=>{
 if((value.callFrom===null)!==(value.callTo===null)||value.callFrom!==null&&value.callTo!<value.callFrom||value.state==='completed'&&(value.winner!=='reply'||value.decision===null||value.callFrom===null)||value.winner!=='reply'&&value.decision!==null)ctx.addIssue({code:z.ZodIssueCode.custom,message:'route observations retain the actual winner and coherent call span'});
});
export const StudioSamplingObservation = z.object({ state: z.enum(['unavailable', 'failed']), detail: z.string().min(1).max(500), turns: z.array(StudioSamplingTurn).optional(), descriptions: StudioSamplingDescriptionInventory.optional(), templates: StudioSamplingDescriptionInventory.optional(), agentQuestions:z.array(StudioSamplingAgentObservation).optional(),agentRoutes:z.array(StudioSamplingRouteObservation).optional(),agentChanges:z.array(StudioSamplingAgentChangeObservation).optional() }).strict();
export type StudioSamplingObservation = z.infer<typeof StudioSamplingObservation>;
export interface StudioSamplingInput extends StudioSavedInput { readonly diagnostic?: z.infer<typeof StudioSamplingDiagnostic>; readonly corpus: StudioSamplingCorpus; readonly requestedTurns: number; readonly resolved?: readonly z.infer<typeof StudioSamplingDependency>[] }
/** The caller verifies the corpus's immutable path/hash before selecting these cloned data. */
export function studioSamplingInput(declaration: StudioSamplingDeclaration, input: StudioSamplingInput): StudioSamplingInput {
 const declared = StudioSamplingDeclaration.parse(declaration);
 if (!Number.isSafeInteger(input.requestedTurns) || input.requestedTurns <= 0) throw new Error('sampling requests a positive counted number of actual turns');
 studioSamplingAgentQuestions(input.corpus);studioSamplingAgentChanges(input.corpus);
 return { ...studioSavedInput({ module: declared.module, reads: declared.reads }, input), corpus: structuredClone(StudioSamplingCorpus.parse(input.corpus)), requestedTurns: input.requestedTurns, ...(input.diagnostic?{diagnostic:StudioSamplingDiagnostic.parse(input.diagnostic)}:{}), ...(input.resolved ? { resolved: input.resolved.map(value => StudioSamplingDependency.parse(value)) } : {}) };
}
/** Structural measured evidence is distinct from independent semantic certification. */
export function checkedStudioSampling(value: unknown, requestedTurns: number, authored: readonly { id: string; inputSha256: string }[], authoredQuestions:readonly {id:string;inputSha256:string}[]=[],authoredChanges:readonly {id:string;inputSha256:string;decision:'do it'|'never mind';undo:boolean;expectations:readonly z.infer<typeof StudioScenarioExpectation>[]}[]=[]): StudioSamplingObservation {
 const observation = StudioSamplingObservation.parse(value), turns = observation.turns ?? [];
 if (!Number.isSafeInteger(requestedTurns) || requestedTurns <= 0 || turns.length > requestedTurns || turns.length > authored.length) throw new Error('sampled turns exceed the requested authored prefix');
 for (let index = 0; index < turns.length; index++) {
  const turn = turns[index]!, expected = authored[index]!, prior = turns[index - 1];
  if (turn.id !== expected.id || turn.inputSha256 !== expected.inputSha256 || turn.afterTick < turn.beforeTick || turn.afterTurns !== turn.beforeTurns + 1 || turn.callTo < turn.callFrom || prior && (turn.beforeTick !== prior.afterTick || turn.beforeHash !== prior.afterHash || turn.beforeTurns !== prior.afterTurns || turn.callFrom <= prior.callTo)) throw new Error('sampled turns do not match actual ordered observations');
 }
 const routes=observation.agentRoutes??[];if(routes.length>Math.min(requestedTurns,authored.length))throw new Error('routing exceeds the authored turn prefix');
 let routeEnd=0;for(let index=0;index<routes.length;index++){const route=routes[index]!,expected=authored[index]!;if(route.id!==expected.id||route.inputSha256!==expected.inputSha256||route.callFrom!==null&&route.callFrom<=routeEnd)throw new Error('routing does not match the ordered authored inputs');if(route.callTo!==null)routeEnd=route.callTo;}
 const questions=observation.agentQuestions??[];if(questions.length>authoredQuestions.length)throw new Error('agent questions exceed the authored prefix');
 let priorEnd=Math.max(turns.at(-1)?.callTo??0,routeEnd);
 for(let index=0;index<questions.length;index++){const question=questions[index]!,expected=authoredQuestions[index]!;if(question.id!==expected.id||question.inputSha256!==expected.inputSha256||question.callFrom!==null&&question.callFrom<=priorEnd)throw new Error('agent questions do not match the ordered authored observations');if(question.callTo!==null)priorEnd=question.callTo;}
 const changes=observation.agentChanges??[];if(changes.length>authoredChanges.length)throw new Error('agent changes exceed the authored prefix');
 for(let index=0;index<changes.length;index++){const change=changes[index]!,expected=authoredChanges[index]!;if(change.id!==expected.id||change.inputSha256!==expected.inputSha256||change.choice!==expected.decision||change.undoRequested!==expected.undo||change.callFrom!==null&&change.callFrom<=priorEnd||change.assertions.checks.some((check,index)=>JSON.stringify(check.expectation)!==JSON.stringify(expected.expectations[index]))||change.choice==='do it'&&change.state==='completed'&&change.assertions.checks.length!==expected.expectations.length)throw new Error('agent changes do not match exact ordered authored actions and expectations');if(change.callTo!==null)priorEnd=change.callTo;}
 const used = new Set<number>();
 for (const inventory of [observation.descriptions, observation.templates]) {
  const items = inventory?.items ?? [], sequences = items.flatMap(item => item.callSequence === null ? [] : [item.callSequence]);
  if (new Set(items.map(item => item.sourceSha256)).size !== items.length || sequences.some((sequence, index) => used.has(sequence) || index > 0 && sequence <= sequences[index - 1]!)) throw new Error('named text sources and classifier sequences must be unique and ordered');
  for (const sequence of sequences) used.add(sequence);
 }
 return observation;
}
/** ew.studio.prompt.v1 hashes actual system/message words, without payer/model/capacity metadata. */
export function studioSamplingPrompt(request: { system?: string; messages: readonly { role: 'user' | 'assistant'; content: string }[] }): string {
 return JSON.stringify({ system: request.system ?? null, messages: request.messages.map(({ role, content }) => ({ role, content })) });
}
