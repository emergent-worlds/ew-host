/** D1/MR5.1: exact wasm bytes from an already selected immutable module tree. */
import { z } from 'zod';
import { FolderRef } from './manifest.js';
import { portablePath } from './builds.js';
import { sha256 } from './sha256.js';
const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Path = z.string().max(512).refine(path => portablePath(path) && !/[%#]/.test(path) && path.endsWith('.wasm') && path.split('/')[0]!.toLowerCase() !== 'uses', 'an exact module wasm path');
export const MechanicSource = z.object({ ref: FolderRef, version: z.string().min(1).max(128), versionId: z.string().min(1).max(128), treeSha256: Hash, path: Path, sha256: Hash }).strict();
export type MechanicSource = z.infer<typeof MechanicSource>;
export interface MechanicModule {
  ref: string; version: string; versionId: string; treeSha256: string; kind: string;
  files: readonly { path: string; sha256: string; size: number; chunks?: readonly string[] }[];
}
export interface MechanicSourceBytes { source: MechanicSource; bytes: Uint8Array }
export const mechanicSourceKey = (source: MechanicSource) => `uses/${source.ref}/${source.path}`;
export function mechanicTreeHash(files: MechanicModule['files']): string {
  return sha256(new TextEncoder().encode(JSON.stringify({ v: 1, files: [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(file => ({ path: file.path, sha256: file.sha256, size: file.size, ...(file.chunks?.length ? { chunks: [...file.chunks] } : {}) })) })));
}
/** Catalogue and reader come from verified checkout/materialization, never a core message. */
export function mechanicSourceReader(modules: readonly MechanicModule[], read: (source: MechanicSource, file: MechanicModule['files'][number]) => Promise<Uint8Array>) {
  // Snapshot caller-owned arrays before any asynchronous request can observe mutation.
  const selected = modules.map(module => ({ ...module, files: module.files.map(file => ({ ...file, ...(file.chunks ? { chunks: [...file.chunks] } : {}) })) }));
  return async (raw: MechanicSource): Promise<MechanicSourceBytes> => {
    const source = MechanicSource.parse(raw);
    const matches = selected.filter(module => module.ref === source.ref);
    const module = matches[0];
    if (matches.length !== 1 || !module || module.kind !== 'module' || module.version !== source.version || module.versionId !== source.versionId || module.treeSha256 !== source.treeSha256 || mechanicTreeHash(module.files) !== source.treeSha256) throw new Error('the mechanic module is not the exact selected immutable module');
    const matchesFile = module.files.filter(file => file.path === source.path), file = matchesFile[0];
    if (matchesFile.length !== 1 || !file || file.sha256 !== source.sha256 || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 65536) throw new Error('the mechanic source is not in its selected module tree');
    const bytes = await read(source, file);
    if (bytes.byteLength !== file.size || sha256(bytes) !== source.sha256) throw new Error('the mechanic source bytes differ from the selected tree');
    return { source, bytes: new Uint8Array(bytes) };
  };
}

/** Reads only source declarations in the exact saved mechanic files. No code runs. */
export function mechanicSourcesInState(files: ReadonlyMap<string, Uint8Array>): MechanicSource[] {
  const sources = new Map<string, MechanicSource>();
  for (const [path, bytes] of files) if (path.startsWith('state/mechanics/') && path.endsWith('.json')) {
    const mechanic = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)) as {body?:unknown;wasm?:{path?:unknown;sha256?:unknown;module?:unknown}};
    if (mechanic?.body !== 'wasm' || !mechanic.wasm?.module) continue;
    const source = MechanicSource.parse({...mechanic.wasm.module as object,path:mechanic.wasm.path,sha256:mechanic.wasm.sha256});
    sources.set(JSON.stringify(source),source);
  }
  return [...sources.values()];
}
