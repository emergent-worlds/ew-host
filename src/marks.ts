import type {SelectedComponents} from './component-selection.js';
/**
 * Whether folders work together, shown as a mod menu shows it (the files page,
 * Section 6; the engines matrix, Section 6; MR5.3).
 *
 * - works: every folder it uses resolves inside its range, every call it needs is
 *   one the engine's interface answers, every part of the state it needs is one
 *   the engine documents, every ask it makes is a part the engine takes, and its
 *   entry runs on this device.
 * - won't work: something it needs is missing: a name that does not resolve, a
 *   call the engine does not answer, a state part the engine does not document, an
 *   ask the engine does not take, or an entry this device cannot run.
 * - may work: everything else, including a version outside a range or a folder
 *   that states no contract. The person can try it, and one undo returns.
 *
 * Pictures (the operator, 2026-10-15): the caller passes whether every image job
 * the folder names can be made for this person, resolved per job (the image job's
 * model, its provider among those the person allows, and the job's route), and the
 * reason for the first that cannot. Where one cannot, a Reality that asks for
 * pictures runs without them and may work, with the reason; one whose manifest says
 * it needs them won't work.
 */
import semver from 'semver';
import type { Manifest } from './manifest.js';
import type { EngineInterface, FolderContract, AskPart } from './interface.js';

export type Mark = 'works' | 'may work' | "won't work";
export interface MarkResult {
  mark: Mark;
  /** One line saying why, for the mark's reason. */
  reason: string;
}

/** What the marks need to know about the folders a manifest names. */
export interface Catalog {
  /** The versions of a folder that exist. */
  versions(ref: string): string[];
  manifest(ref: string, version: string): Manifest | undefined;
  engineInterface(ref: string, version: string): EngineInterface | undefined;
  contract(ref: string, version: string): FolderContract | undefined;
}

export type Device = 'computer' | 'phone';

/**
 * Whether every image job the folder names can be made for this person, each
 * resolved on its own (its model, that model's provider among those the person
 * allows, and the job's route), and if not, the line saying why the first cannot.
 */
export interface Pictures {
  available: boolean;
  reason: string;
}

/** The asks whose part the folder's own code must take, from a manifest's asks. */
export function askParts(m: Manifest): AskPart[] {
  const a = m.asks;
  if (!a) return [];
  const parts: AskPart[] = [];
  if (a.saves) parts.push('saves');
  if (a.while_away) parts.push('while_away');
  if (a.players > 1) parts.push('players');
  if (a.agent !== 'none') parts.push('agent.read');
  if (a.agent === 'change') parts.push('agent.change');
  if (a.models) parts.push('models');
  return parts;
}

/** Resolves each folder a manifest uses to the best version in its range, or the latest when none fits. */
export function resolveUses(m: Manifest, catalog: Catalog): { resolved: Map<string, string>; outside?: string; missing?: string } {
  // Transitive: a Reality uses its pack, which uses the engine, so the engine's interface and the
  // pack's contract are reached through the pack (the App's request 1, 2026-10-15). The first range
  // that names a folder decides its version.
  const resolved = new Map<string, string>();
  let outside: string | undefined;
  const queue: [string, string][] = Object.entries(m.uses);
  while (queue.length) {
    const [ref, range] = queue.shift()!;
    if (resolved.has(ref)) continue;
    const versions = catalog.versions(ref);
    if (versions.length === 0) return { resolved, missing: ref };
    let best = semver.maxSatisfying(versions, range);
    if (!best) {
      best = semver.rsort([...versions])[0]!;
      outside ??= `${ref} ${best} is outside the range ${range} it names`;
    }
    resolved.set(ref, best);
    for (const next of Object.entries(catalog.manifest(ref, best)?.uses ?? {})) if (!resolved.has(next[0])) queue.push(next);
  }
  return { resolved, outside };
}

/**
 * The entry a folder runs with: its own, or the entry of the nearest folder in
 * its uses that names one, usually its pack (the wave 2 design, D5). Returns the
 * folder that carries the entry, so the host can lay its files out.
 */
export function resolveEntry(m: Manifest, catalog: Catalog, resolved: Map<string, string>): { ref: string | null; entry: NonNullable<Manifest['entry']> } | undefined {
  if (m.entry) return { ref: null, entry: m.entry };
  for (const [ref, version] of resolved) {
    const used = catalog.manifest(ref, version);
    if (used?.entry) return { ref, entry: used.entry };
  }
  return undefined;
}

/**
 * Marks a folder (a Reality, or one it might add or move to) against what it
 * uses, for one device. `engineRef` names the engine the folder runs on, found
 * through its uses.
 */
export function markFolder(m: Manifest, catalog: Catalog, device: Device, engineRef?: string, pictures?: Pictures, selection?:SelectedComponents): MarkResult {
  if (device === 'phone' && m.entry && m.entry.web === undefined && m.entry.installs) {
    return { mark: "won't work", reason: 'it installs on a computer and has no entry for a phone' };
  }
  const { resolved, outside, missing } = resolveUses(m, catalog);
  if (missing) return { mark: "won't work", reason: `${missing} cannot be found` };
  let mayWork = outside;
  if (m.asks && !(selection?.entry??resolveEntry(m, catalog, resolved))) {
    return { mark: "won't work", reason: 'nothing it uses names an entry for it to run with' };
  }
  if(selection)for(const [ref,version]of resolved){
    const used=catalog.manifest(ref,version);if(used?.kind!=='module'&&used?.kind!=='pack')continue;
    const contract=catalog.contract(ref,version);if(!contract){mayWork??=`${ref} states no contract`;continue;}
    if(selection?.engine===null&&(contract.needs.calls.length||contract.needs.state.length))return {mark:"won't work",reason:`${ref} needs an engine which is not selected`};
    for(const [fit,range]of Object.entries(contract.fits)){
      const target=(m.kind===fit?m.version:resolved.get(fit))??[...resolved].find(([other,v])=>catalog.manifest(other,v)?.kind===fit)?.[1];
      if(!target||!semver.validRange(range)||!semver.satisfies(target,range))mayWork??=`${ref} does not confirm compatibility with ${fit} ${range}`;
    }
  }
  if(selection){
    const entry=selection.entry,carrier=entry.ref===null?m:catalog.manifest(entry.ref,resolved.get(entry.ref)??'');
    if(!carrier?.entry||device==='phone'&&!entry.web||device==='computer'&&!entry.web&&!entry.headless)return {mark:"won't work",reason:'the selected entry cannot run on this device'};
    const gives=entry.ref?catalog.contract(entry.ref,resolved.get(entry.ref)??'')?.adds.gives??[]:[];
    for(const [slot,modules]of Object.entries(selection.slots)){
      if(!gives.includes(slot as import('./interface.js').Slot))return {mark:"won't work",reason:`the selected entry does not expose the ${slot} slot`};
      for(const module of modules)if(!catalog.contract(module.ref,resolved.get(module.ref)??'')?.adds.slots.includes(slot as import('./interface.js').Slot))return {mark:"won't work",reason:`${module.ref} does not provide the ${slot} slot`};
    }
  }
  if (engineRef) {
    const ev = resolved.get(engineRef);
    const iface = ev ? catalog.engineInterface(engineRef, ev) : undefined;
    if (!iface) {
      mayWork ??= `${engineRef} states no interface`;
    } else {
      for (const part of askParts(m)) {
        if (!iface.takes.includes(part)) return { mark: "won't work", reason: `${engineRef} does not take the ${part} ask` };
      }
      for (const [ref, v] of resolved) {
        if (ref === engineRef) continue;
        // A pack may retain its base engine while a sole direct engine is selected for execution.
        // Engines expose interfaces; they do not become packs requiring a contract here.
        if (catalog.manifest(ref, v)?.kind === 'engine' && catalog.engineInterface(ref, v)) continue;
        const c = catalog.contract(ref, v);
        if (!c) {
          mayWork ??= `${ref} states no contract`;
          continue;
        }
        for (const call of c.needs.calls) {
          if (!iface.calls.includes(call)) return { mark: "won't work", reason: `${ref} needs ${call}, which ${engineRef} does not answer` };
        }
        for (const part of c.needs.state) {
          if (iface.state.length === 0) {
            mayWork ??= `${engineRef} does not document the parts of its state`;
            break;
          }
          if (!iface.state.includes(part)) return { mark: "won't work", reason: `${ref} needs the ${part} part of the state, which ${engineRef} does not document` };
        }
      }
    }
  }
  const images = m.asks?.models?.image_jobs.length ? m.asks.models : undefined;
  if (images && pictures && !pictures.available) {
    if (images.pictures === 'needed') return { mark: "won't work", reason: pictures.reason };
    mayWork ??= pictures.reason;
  }
  if (mayWork) return { mark: 'may work', reason: mayWork };
  return { mark: 'works', reason: 'everything it needs is there' };
}
