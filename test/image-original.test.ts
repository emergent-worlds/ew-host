import {expect,it} from 'vitest';
import {ImageModelRequest} from '../src/protocol.js';
it('retains explicit caller image identity and original-only intent without changing old image callers',()=>{
 const old={kind:'image',prompt:'Salt Harbor'};expect(ImageModelRequest.parse(old)).toMatchObject({kind:'image',prompt:'Salt Harbor'});
 const requestId='7b325011-20a1-4ea0-ab90-0db06e4efb06';expect(ImageModelRequest.parse({...old,requestId,originalOnly:true})).toMatchObject({requestId,originalOnly:true});expect(()=>ImageModelRequest.parse({...old,requestId:'not-an-id'})).toThrow();
});
