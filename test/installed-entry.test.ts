import {describe,it,expect} from 'vitest';
import {Manifest} from '../src/manifest.js';
const manifest={name:'Kestrel Yards',kind:'reality',version:'1.0.2',owner:'@mercerpress',entry:{installs:{'macos-arm64':'native/mac'},executables:{'macos-arm64':'native/mac/Yards.app/Contents/MacOS/Yards'}}};
describe('explicit installed executable declaration',()=>{
 it('retains an exact alternative bundle path and leaves declarationless legacy manifests unchanged',()=>{
  expect(Manifest.parse(manifest).entry?.executables).toEqual(manifest.entry.executables);
  const legacy=Manifest.parse({...manifest,entry:{installs:manifest.entry.installs}});expect(Object.hasOwn(legacy.entry!,'executables')).toBe(false);
 });
 it('requires the exact installed target set without granting missing or extra targets',()=>{
  for(const entry of [{executables:manifest.entry.executables},{installs:manifest.entry.installs,executables:{}},{installs:{...manifest.entry.installs,'linux-x64':'native/linux'},executables:manifest.entry.executables},{...manifest.entry,executables:{...manifest.entry.executables,'linux-x64':'native/linux/run'}}])expect(Manifest.safeParse({...manifest,entry}).success).toBe(false);
 });
 it('refuses traversal, case aliases, ambiguous prefixes and nonportable executable paths',()=>{
  for(const path of ['native/mac','native/Mac/Yards','native/mac/../Yards','native/mac/CON','native/mac/hidden.','native/mac/a%20b','native/mac/a\\b','native/mac/é'])expect(Manifest.safeParse({...manifest,entry:{...manifest.entry,executables:{'macos-arm64':path}}}).success).toBe(false);
  for(const prefix of ['Native/MAC','native/mac/other'])expect(Manifest.safeParse({...manifest,entry:{installs:{...manifest.entry.installs,'linux-x64':prefix},executables:{...manifest.entry.executables,'linux-x64':prefix+'/run'}}}).success).toBe(false);
 });
});
