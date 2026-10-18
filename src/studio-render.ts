import type {SelectedComponents} from './component-selection.js';
import type {SelectedEngine} from './engine-selection.js';
/** S8.2: a pack-owned saved-snapshot view, with no play or persistence port. */
import type { Manifest } from './manifest.js';
import { Manifest as ManifestSchema } from './manifest.js';
import { Display } from './protocol.js';
import { StudioSnapshot, StudioValidationDeclaration, studioSavedInput } from './studio-validation.js';
import type { z } from 'zod';
/** Reads selects input bytes; it does not establish JavaScript filesystem isolation. */
export const StudioRenderDeclaration = StudioValidationDeclaration;
export type StudioRenderDeclaration = z.infer<typeof StudioRenderDeclaration>;
export interface StudioRenderInput {
  readonly selectedEngine?: SelectedEngine;
  readonly selectedComponents?: SelectedComponents;
  readonly componentBindingDigest?: string;
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
  const selected = studioSavedInput(declaration, input);
  return { ...selected, manifest: ManifestSchema.parse(selected.manifest), display: Display.parse(structuredClone(input.display)) };
}
