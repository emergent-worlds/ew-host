/** Wave 3 E7: the authoritative core and each person's page have separate host ports. */
import type { FolderMessage, HostMessage } from './protocol.js';

/** combined is only the existing single-port local connection during consumer migration. */
export type EndpointFamily = 'combined' | 'core' | 'page';
const PAGE_OUT = new Set<FolderMessage['type']>(['ready', 'file.pick', 'file.export', 'prefs.set', 'app.open', 'reply']);
const PAGE_IN = new Set<HostMessage['type']>(['grant', 'corner', 'display', 'layout.set', 'layout.reset', 'reply']);
const SHARED_OUT = new Set<FolderMessage['type']>(['ready', 'reply']);
const SHARED_IN = new Set<HostMessage['type']>(['grant', 'display', 'reply']);

export function endpointSends(family: EndpointFamily, type: FolderMessage['type']): boolean {
  return family === 'combined' || (family === 'page' ? PAGE_OUT.has(type) : !PAGE_OUT.has(type) || SHARED_OUT.has(type));
}
export function endpointReceives(family: EndpointFamily, type: HostMessage['type']): boolean {
  return family === 'combined' || (family === 'page' ? PAGE_IN.has(type) : !PAGE_IN.has(type) || SHARED_IN.has(type));
}
