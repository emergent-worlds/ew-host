/** E12/E16: fixed canonical bytes signed by the platform and verified by native installers. */
import { z } from 'zod';
import { BuildTarget } from './manifest.js';

export const BuildFile = z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), executable: z.boolean() }).strict();
export type BuildFile = z.infer<typeof BuildFile>;
const BuildShape = z.object({ domain: z.literal('ew.build-files.v1'), folder: z.string(), version: z.string(), target: BuildTarget, prefix: z.string(), entry: z.string(), files: z.array(BuildFile).min(1).max(10_000) }).strict();
export const BuildList = BuildShape.superRefine((list, ctx) => {
  try { encodeChecked(list); } catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid installed build list' }); }
});
export type BuildList = z.infer<typeof BuildList>;
export const SignedBuild = z.object({ payload: z.string().min(1), signature: z.string().min(1) }).strict();
export type SignedBuild = z.infer<typeof SignedBuild>;

const targets = new Set<BuildTarget>(BuildTarget.options);
const id = /^[a-z0-9_-]+$/i;
export function portablePath(path: string): boolean {
  return !!path && /^[\x20-\x7e]+$/.test(path) && !/[\\:*?"<>|]/.test(path) && path.split('/').every(p => !!p && p !== '.' && p !== '..' && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}
function encodeChecked(list: BuildList): string {
  if (list.domain !== 'ew.build-files.v1' || !id.test(list.folder) || !id.test(list.version) || !targets.has(list.target) || !portablePath(list.prefix) || !portablePath(list.entry) || !list.entry.startsWith(`${list.prefix}/`)) throw new Error('invalid build identity or entry');
  if (!Array.isArray(list.files) || !list.files.length || list.files.length > 10_000) throw new Error('invalid build file count');
  const files = [...list.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const names = new Set<string>(); let total = 0;
  for (const f of files) {
    const path = f.path.toLowerCase();
    if (!portablePath(f.path) || !f.path.startsWith(`${list.prefix}/`) || names.has(path) || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0 || typeof f.executable !== 'boolean') throw new Error('invalid or colliding build file');
    names.add(path); total += f.size;
    if (!Number.isSafeInteger(total)) throw new Error('build size overflow');
  }
  for (const f of files) { const parts = f.path.toLowerCase().split('/'); parts.pop(); while (parts.length) { if (names.has(parts.join('/'))) throw new Error('a build file is also a directory'); parts.pop(); } }
  if (!files.some(f => f.path === list.entry && f.executable)) throw new Error('entry is not a listed executable');
  return JSON.stringify({ domain: list.domain, folder: list.folder, version: list.version, target: list.target, prefix: list.prefix, entry: list.entry, files: files.map(f => ({ path: f.path, sha256: f.sha256, size: f.size, executable: f.executable })) });
}
/** Sorts files and encodes only the exact versioned fields, after strict schema validation. */
export function canonicalBuildList(list: BuildList): string {
  return encodeChecked(BuildList.parse(list));
}
/** Rejects unknown fields, duplicate keys, alternate order/whitespace and coercions. */
export function parseBuildList(payload: string): BuildList {
  try {
    const list = BuildList.parse(JSON.parse(payload));
    if (canonicalBuildList(list) !== payload) throw new Error();
    return list;
  } catch { throw new Error('invalid or noncanonical build list'); }
}
