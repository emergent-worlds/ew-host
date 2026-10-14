/**
 * Whether folders work together, shown as a mod menu shows it (the files page,
 * Section 6; the engines matrix, Section 6; MR5.3).
 *
 * - works: every folder it uses resolves inside its range, every call it needs is
 *   one the engine's interface answers, every ask it makes is a part the engine
 *   takes, and its entry runs on this device.
 * - won't work: something it needs is missing: a name that does not resolve, a
 *   call the engine does not answer, an ask the engine does not take, or an entry
 *   this device cannot run.
 * - may work: everything else, including a version outside a range or a folder
 *   that states no contract. The person can try it, and one undo returns.
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

/** The asks whose part the folder's own code must take, from a manifest's asks. */
export function askParts(m: Manifest): AskPart[] {
  const a = m.asks;
  if (!a) return [];
  const parts: AskPart[] = [];
  if (a.saves) parts.push('saves');
  if (a.while_away) parts.push('while_away');
  if (a.players > 1) parts.push('players');
  if (a.agent === 'change') parts.push('agent.change');
  if (a.models) parts.push('models');
  return parts;
}

/**
 * Marks a folder (a Reality, or one it might add or move to) against what it
 * uses, for one device. `engineRef` names the engine the folder runs on, found
 * through its uses.
 */
export function markFolder(m: Manifest, catalog: Catalog, device: Device, engineRef?: string): MarkResult {
  if (device === 'phone' && m.entry && m.entry.web === undefined && m.entry.installs) {
    return { mark: "won't work", reason: 'it installs on a computer and has no entry for a phone' };
  }
  let mayWork: string | undefined;
  const resolved = new Map<string, string>();
  for (const [ref, range] of Object.entries(m.uses)) {
    const versions = catalog.versions(ref);
    if (versions.length === 0) return { mark: "won't work", reason: `${ref} cannot be found` };
    const best = semver.maxSatisfying(versions, range);
    if (best) {
      resolved.set(ref, best);
    } else {
      const latest = semver.rsort([...versions])[0]!;
      resolved.set(ref, latest);
      mayWork ??= `${ref} ${latest} is outside the range ${range} it names`;
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
        const c = catalog.contract(ref, v);
        if (!c) {
          mayWork ??= `${ref} states no contract`;
          continue;
        }
        for (const call of c.needs.calls) {
          if (!iface.calls.includes(call)) return { mark: "won't work", reason: `${ref} needs ${call}, which ${engineRef} does not answer` };
        }
      }
    }
  }
  if (mayWork) return { mark: 'may work', reason: mayWork };
  return { mark: 'works', reason: 'everything it needs is there' };
}
