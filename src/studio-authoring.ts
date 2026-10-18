import type {StudioSavedInput} from './studio-validation.js';
/** Private execution ports installed by the trusted Studio executor, never saved declarations. */
export interface StudioAuthoringSession {
  readonly executionId: string;
  readonly actor: string;
  readonly actorGeneration: string;
  readonly contextDigest: string;
  readonly validUntil: number;
  now(): number;
  assertCurrent(): void;
}
export interface StudioAuthoringPorts {
  /** The executor accepts only its exact run input object, once per copied host. */
  authoring?(input: StudioSavedInput): StudioAuthoringSession;
}
