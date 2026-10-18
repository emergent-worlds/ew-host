/** Private core/host transaction evidence. These records never grant authority by shape. */
import {z} from 'zod';
const identity = z.string().min(1).max(512);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const path = z.string().min(1).max(512).refine(value => !value.startsWith('/') && !value.split('/').some(part => !part || part === '..' || part === '.'));
const time = z.number().int().nonnegative().safe();
export const ScopedActorBinding = z.object({
  hostGeneration: identity,
  actorGeneration: identity,
  /** A host-derived local player or actual admitted sender, never model input. */
  actor: identity,
  purpose: z.enum(['player', 'creator']),
  operationId: identity,
  leaseUntil: time,
}).strict();
export type ScopedActorBinding = z.infer<typeof ScopedActorBinding>;
export const ScopedTransactionGrant = z.object({
  protocol: z.literal(1),
  hostGeneration: identity,
  coreGeneration: identity,
  policyIdentity: digest,
}).strict();
export type ScopedTransactionGrant = z.infer<typeof ScopedTransactionGrant>;
const file = z.object({path, sha256: digest}).strict();
export const ScopedObservationInput = z.object({
  binding: ScopedActorBinding,
  coreGeneration: identity,
  policyIdentity: digest,
  action: z.enum(['apply', 'undo', 'directive']),
  proposal: identity.nullable(),
  decision: identity.nullable(),
  engine: z.object({hash: digest, tick: z.number().int().nonnegative().safe(), paths: z.array(path).min(1).max(10000)}).strict(),
  /** The entire remaining tree, not an exempted prefix. Absence means deletion. */
  outside: z.array(file).max(10000),
}).strict().superRefine((value, context) => {
  const paths = [...value.engine.paths, ...value.outside.map(file => file.path)];
  const ordered = (items: string[]) => items.every((item, index) => !index || items[index - 1]! < item);
  if (!ordered(value.engine.paths) || !ordered(value.outside.map(file => file.path)) || new Set(paths).size !== paths.length) context.addIssue({code: 'custom', message: 'Exact Engine and outside paths must be unique, disjoint and ordered.'});
  if (value.action === 'apply' && (!value.proposal || !value.decision) || value.action === 'undo' && (!value.proposal || value.decision !== null) || value.action === 'directive' && (value.proposal !== null || value.decision !== null)) context.addIssue({code: 'custom', message: 'The transaction must name its exact proposal and actual decision.'});
});
export type ScopedObservationInput = z.infer<typeof ScopedObservationInput>;
export const ScopedObservation = z.object({
  input: ScopedObservationInput,
  observationId: identity,
  expectedParent: identity,
  observedAt: time,
  validUntil: time,
}).strict().superRefine((value, context) => {
  if (value.observedAt >= value.validUntil || value.validUntil > value.input.binding.leaseUntil) context.addIssue({code: 'custom', message: 'The observation must remain inside its actual actor lease.'});
});
export type ScopedObservation = z.infer<typeof ScopedObservation>;

export interface ScopedHostAuthority {
  /** Supplied only by the host's admitted player or editing composition. */
  readonly actor: string;
  readonly actorGeneration: string;
  readonly purpose: 'player' | 'creator';
  readonly leaseUntil: number;
  assertCurrent(): void;
  authorize(): Promise<void>;
}
export interface ScopedHostTree {readonly parent: string; readonly files: readonly {readonly path: string; readonly sha256: string}[]}
interface ScopedActiveOperation {
  readonly binding: ScopedActorBinding;
  readonly authority: ScopedHostAuthority;
  readonly action: ScopedObservationInput['action'];
  readonly proposal: string | null;
  readonly decision: string | null;
  observed: boolean;
}
/**
 * Hosts inject their existing CoreOperations queue. A nested observation belongs
 * to the operation already holding that queue; it must never queue behind itself.
 */
export interface ScopedHostTransactionOptions {
  grant: ScopedTransactionGrant;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  assertCurrent(): void;
  tree(): ScopedHostTree;
  now(): number;
  id(): string;
}
export class ScopedHostTransactions {
  readonly grant: ScopedTransactionGrant;
  private active: ScopedActiveOperation | undefined;
  private blocked = false;
  private readonly options: Readonly<ScopedHostTransactionOptions>;
  constructor(options: ScopedHostTransactionOptions) {
    this.grant = Object.freeze(ScopedTransactionGrant.parse(options.grant));
    this.options = Object.freeze({grant: this.grant, exclusive: options.exclusive.bind(options), assertCurrent: options.assertCurrent.bind(options), tree: options.tree.bind(options), now: options.now.bind(options), id: options.id.bind(options)});
  }
  assertAvailable(): void {
    this.options.assertCurrent();
    if (this.blocked) throw new Error('The original transaction save must be recovered or the persisted core reloaded.');
  }
  /** A failed or unknown inverse save can never issue the inverse a second time. */
  blockRecovery(): void { this.blocked = true; }
  run<T>(authority: ScopedHostAuthority, operation: Pick<ScopedObservationInput, 'action' | 'proposal' | 'decision'>, work: (binding: ScopedActorBinding) => Promise<T>): Promise<T> {
    const admitted: ScopedHostAuthority = Object.freeze({actor: authority.actor, actorGeneration: authority.actorGeneration, purpose: authority.purpose, leaseUntil: authority.leaseUntil, assertCurrent: authority.assertCurrent.bind(authority), authorize: authority.authorize.bind(authority)});
    const selected = Object.freeze({...operation});
    return this.options.exclusive(async () => {
      this.assertAvailable(); admitted.assertCurrent();
      if (this.active) throw new Error('A different guarded transaction is already active.');
      const binding = Object.freeze(ScopedActorBinding.parse({hostGeneration: this.grant.hostGeneration, actor: admitted.actor, actorGeneration: admitted.actorGeneration, purpose: admitted.purpose, operationId: this.options.id(), leaseUntil: admitted.leaseUntil}));
      if (this.options.now() >= binding.leaseUntil) throw new Error('The original actor lease expired.');
      const active: ScopedActiveOperation = {binding, authority: admitted, ...selected, observed: false};
      this.active = active;
      try { return await work(binding); }
      finally { if (this.active === active) this.active = undefined; }
    });
  }
  async observe(raw: ScopedObservationInput): Promise<ScopedObservation> {
    const input = ScopedObservationInput.parse(raw), active = this.active;
    const assert = () => {
      this.assertAvailable();
      if (!active || this.active !== active || active.observed || input.coreGeneration !== this.grant.coreGeneration || input.policyIdentity !== this.grant.policyIdentity || JSON.stringify(input.binding) !== JSON.stringify(active.binding) || input.action !== active.action || input.proposal !== active.proposal || input.decision !== active.decision) throw new Error('No matching original guarded operation holds the core.');
      active.authority.assertCurrent();
      if (this.options.now() >= active.binding.leaseUntil) throw new Error('The original actor lease expired.');
    };
    assert();
    await active!.authority.authorize();
    assert();
    const tree = this.options.tree(), owned = new Set(input.engine.paths);
    const hostPaths = new Set(tree.files.map(file => file.path));
    if (hostPaths.size !== tree.files.length || input.engine.paths.some(path => !hostPaths.has(path))) throw new Error('The complete saved Engine path identity is unavailable.');
    const outside = tree.files.filter(file => !owned.has(file.path)).map(file => ({path: file.path, sha256: file.sha256})).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (JSON.stringify(outside) !== JSON.stringify(input.outside)) throw new Error('The outside files changed during the guarded operation.');
    const observedAt = this.options.now();
    const result = ScopedObservation.parse({input, observationId: this.options.id(), expectedParent: tree.parent, observedAt, validUntil: active!.binding.leaseUntil});
    assert();
    active!.observed = true;
    return result;
  }
}
