/** S8.2: a pack-owned saved-snapshot view, with no play or persistence port. */
import type { Manifest } from './manifest.js';
import { Manifest as ManifestSchema } from './manifest.js';
import { Display } from './protocol.js';
import { StudioSnapshot, StudioValidationDeclaration } from './studio-validation.js';
import { portablePath } from './builds.js';
import type { z } from 'zod';
/** Reads selects input bytes; it does not establish JavaScript filesystem isolation. */
export const StudioRenderDeclaration = StudioValidationDeclaration;
export type StudioRenderDeclaration = z.infer<typeof StudioRenderDeclaration>;
export interface StudioRenderInput {
  readonly snapshot: z.infer<typeof StudioSnapshot>;
  readonly manifest: Manifest;
  readonly paths: readonly string[];
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly display: z.infer<typeof Display>;
}
export interface StudioRenderHandle { update(input: StudioRenderInput): void | Promise<void>; unmount(): void }
export interface StudioRenderModule { mountStudio(element: HTMLElement, input: StudioRenderInput): StudioRenderHandle | Promise<StudioRenderHandle> }
/** The caller verifies immutable tree/byte identities before selecting this view's inputs. */
export function studioRenderInput(declaration: StudioRenderDeclaration, input: StudioRenderInput): StudioRenderInput {
  const declared = StudioRenderDeclaration.parse(declaration), snapshot = StudioSnapshot.parse(input.snapshot), files = new Map<string, Uint8Array>();
  if (new Set(input.paths.map(path => path.toLowerCase())).size !== input.paths.length || input.paths.some(path => !portablePath(path) || /[%#]/.test(path) || path.split('/')[0]!.toLowerCase() === 'uses')) throw new Error('invalid Studio own-file inventory');
  for (const path of input.paths) if (declared.reads.some(read => read.endsWith('/') ? path.startsWith(read) : path === read)) {
    const bytes = input.files.get(path); if (!(bytes instanceof Uint8Array)) throw new Error('selected Studio bytes are missing'); files.set(path, new Uint8Array(bytes));
  }
  return { snapshot, manifest: ManifestSchema.parse(structuredClone(input.manifest)), paths: [...input.paths], files, display: Display.parse(structuredClone(input.display)) };
}
