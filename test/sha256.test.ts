import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { sha256 } from '../src/sha256.js';
it('matches independent SHA-256 across block padding, Unicode and typed-array offsets',()=>{
 for(const length of [0,1,55,56,63,64,65,127,128,1024]){const data=new Uint8Array(length+7);for(let i=0;i<data.length;i++)data[i]=i%251;const bytes=data.subarray(3,length+3);expect(sha256(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));}
 const words=new TextEncoder().encode('Salt Harbor 🌊');expect(sha256(words)).toBe(createHash('sha256').update(words).digest('hex'));
});
