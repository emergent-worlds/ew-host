import {expect,it} from 'vitest';
import {Asks} from '../src/manifest.js';
import {permitted} from '../src/protocol.js';
it('refuses both file dialogs for the default and explicit headless surface',()=>{
 for(const asks of [Asks.parse({}),Asks.parse({surface:'none'})])for(const message of [{ew:1 as const,id:1,type:'file.pick' as const,accept:['.txt']},{ew:1 as const,id:2,type:'file.export' as const,name:'Salt Harbor.txt',mime:'text/plain',data:'YQ=='}])expect(permitted(message,asks).ok).toBe(false);
});
it('visible surface admission does not itself supply native approval',()=>{
 for(const surface of ['full','panel','window'])expect(permitted({ew:1 as const,id:1,type:'file.pick',accept:['.txt']},Asks.parse({surface})).ok).toBe(true);
});
