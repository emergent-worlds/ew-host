import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BuildList, SignedBuild, canonicalBuildList, parseBuildList, portablePath } from '../src/index.js';
const vector = readFileSync(new URL('./fixtures/build-list-v1.json', import.meta.url), 'utf8');
it('preserves the exact native installer canonical vector and key order', () => {
  const list = parseBuildList(vector); expect(canonicalBuildList(list)).toBe(vector);
  expect(createHash('sha256').update(vector).digest('hex')).toBe('92889e89c13c51b379cf9ef19007c1899380bccea893925d8029453269bef151');
  expect(SignedBuild.safeParse({ payload: vector, signature: 'public vector supplied by verifier' }).success).toBe(true);
  expect(SignedBuild.safeParse({ payload: vector, signature: '', publicKey: 'untrusted' }).success).toBe(false);
});
it('rejects unknown keys, duplicate keys, alternate bytes and integer coercion', () => {
  for (const bad of [vector + '\n', vector.replace('"domain":', '"extra":true,"domain":'), vector.replace('"domain":', '"domain":"bad","domain":'), vector.replace('"size":4', '"size":4.0')]) expect(() => parseBuildList(bad)).toThrow('noncanonical');
  expect(() => canonicalBuildList({ ...parseBuildList(vector), extra: true } as never)).toThrow();
});
it('sorts independent file input and rejects collisions or directory conflicts', () => {
  const list = parseBuildList(vector); const first = list.files[0]!; const extra = { ...first, path: 'build/linux/aaa', executable: false };
  expect(parseBuildList(canonicalBuildList({ ...list, files: [first, extra] })).files[0]!.path).toBe(extra.path);
  for (const path of ['build/linux/GAME', 'build/linux/game/child']) expect(BuildList.safeParse({ ...list, files: [first, { ...first, path }] }).success).toBe(false);
});
it('refuses unsafe paths, invalid binding, nonexecutables and numeric overflow', () => {
  for (const path of ['/root', '../root', 'a//b', 'a/CON.txt', 'a/lpt9', 'a/trailing.', 'a/a\\b', 'a/é', 'a/C:/root']) expect(portablePath(path)).toBe(false);
  const list = parseBuildList(vector);
  for (const patch of [{ folder: '../folder' }, { entry: 'outside/game' }, { prefix: 'outside' }, { files: [{ ...list.files[0]!, executable: false }] }, { files: [{ ...list.files[0]!, size: Number.MAX_SAFE_INTEGER + 1 }] }]) expect(BuildList.safeParse({ ...list, ...patch }).success).toBe(false);
});
