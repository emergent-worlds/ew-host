import {expect,it} from 'vitest';
import {TextModelRequest} from '../src/protocol.js';
const base={kind:'text',messages:[{role:'user',content:'Recorded harbor events.'}],stream:false};
it('preserves separate prepared and exact original intents while keeping ordinary text compatible',()=>{
 expect(TextModelRequest.parse(base)).not.toHaveProperty('awayOriginal');
 expect(TextModelRequest.parse({...base,awayOriginal:{prepare:true}}).awayOriginal).toEqual({prepare:true});
 const original={requestId:'c0488ade-1a33-4d38-8b60-df492915cc8a',sourceVersion:'acknowledged-save',originalOnly:false};
 expect(TextModelRequest.parse({...base,awayOriginal:original}).awayOriginal).toEqual(original);
 expect(TextModelRequest.safeParse({...base,awayOriginal:{prepare:true,...original}}).success).toBe(false);
 expect(TextModelRequest.safeParse({...base,awayOriginal:{requestId:'untracked'}}).success).toBe(false);
});
