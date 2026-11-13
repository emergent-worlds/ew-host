import { z } from 'zod';
import type { Transport } from './bridge.js';
import { InputKind } from './manifest.js';
import { PortCall, PortNotice, servePort, type PortServer } from './port.js';
import { RemotePlayer } from './remote-schema.js';

/** These calls run on a private channel between the trusted server and its game. */
export const REMOTE_PLAYER_PROJECTION_METHODS = {
  describe: 'ew.remote.describe',
  admit: 'ew.remote.admit',
  snapshot: 'ew.remote.snapshot',
  call: 'ew.remote.call',
  input: 'ew.remote.input',
  notice: 'ew.remote.notice',
} as const;

const rawCoreCalls = new Set(['load', 'save', 'advance', 'input', 'read', 'query', 'explain', 'forecast', 'change', 'pause', 'resume', 'quit']);
const hostNamespace = /^(?:ew|file|state|model|agent|prefs|app|layout)(?:\.|$)/;
const gameCall = PortCall.shape.call.refine(name => !rawCoreCalls.has(name) && !hostNamespace.test(name), 'reserved remote call');
const unique = (values: string[]) => new Set(values).size === values.length;

export const RemotePlayerProjectionDescriptor = z.object({
  protocol: z.literal('ew.remote-player.v1'),
  calls: z.array(gameCall).max(128).refine(unique, 'duplicate remote call'),
  inputs: z.array(InputKind).max(4).refine(unique, 'duplicate remote input'),
}).strict();
export const RemotePlayerProjectionIdentity = RemotePlayer;
export const RemotePlayerProjectionSelection = RemotePlayer.pick({ sender: true });
export const RemotePlayerProjectionCall = RemotePlayerProjectionSelection.extend({
  call: gameCall,
  args: z.unknown().optional(),
});
export const RemotePlayerProjectionInput = RemotePlayerProjectionSelection.extend({
  kind: InputKind,
  data: z.unknown().refine(value => value !== undefined, 'input has data'),
});
const gameNotice = PortNotice.strict().extend({
  notice: PortNotice.shape.notice.refine(name => !name.startsWith('ew.remote.'), 'reserved remote notice'),
});
export const RemotePlayerProjectionSnapshot = z.array(gameNotice).max(1000);
export const RemotePlayerProjectionNotice = RemotePlayerProjectionSelection.extend({ notice: gameNotice });

export type RemotePlayerProjectionDescriptor = z.infer<typeof RemotePlayerProjectionDescriptor>;
export type RemotePlayerProjectionIdentity = z.infer<typeof RemotePlayerProjectionIdentity>;
export type RemotePlayerProjectionSelection = z.infer<typeof RemotePlayerProjectionSelection>;
export type RemotePlayerProjectionCall = z.infer<typeof RemotePlayerProjectionCall>;
export type RemotePlayerProjectionInput = z.infer<typeof RemotePlayerProjectionInput>;
export type RemotePlayerProjectionSnapshot = z.infer<typeof RemotePlayerProjectionSnapshot>;
export type RemotePlayerProjectionNotice = z.infer<typeof RemotePlayerProjectionNotice>;

export interface RemotePlayerProjectionHandlers {
  admit(player: RemotePlayerProjectionIdentity): void | Promise<void>;
  snapshot(player: RemotePlayerProjectionSelection): RemotePlayerProjectionSnapshot | Promise<RemotePlayerProjectionSnapshot>;
  call(operation: RemotePlayerProjectionCall): unknown;
  input(operation: RemotePlayerProjectionInput): void | Promise<void>;
}

export interface RemotePlayerProjectionServer {
  notify(sender: string, notice: PortNotice): void;
  close(): void;
}

type Operation = Parameters<typeof servePort>[1][string];
function guarded(operation: (args: unknown) => unknown): Operation {
  return async (args, from) => {
    try {
      if (from !== undefined) throw new Error('projection does not take an envelope sender');
      return await operation(args);
    } catch {
      throw new Error('the game refused the remote projection operation');
    }
  };
}

/** The peer owns admission and supplies only the public identity of its current player. */
export function serveRemotePlayerProjection(transport: Transport, descriptor: RemotePlayerProjectionDescriptor,
  handlers: RemotePlayerProjectionHandlers): RemotePlayerProjectionServer {
  const supported = RemotePlayerProjectionDescriptor.parse(descriptor);
  const calls = new Set(supported.calls), inputs = new Set(supported.inputs);
  const methods = REMOTE_PLAYER_PROJECTION_METHODS;
  const operations: Record<string, Operation> = {
    [methods.describe]: guarded(args => {
      if (args !== undefined) throw new Error('describe has no arguments');
      return RemotePlayerProjectionDescriptor.parse(supported);
    }),
    [methods.admit]: guarded(async args => { await handlers.admit(RemotePlayerProjectionIdentity.parse(args)); }),
    [methods.snapshot]: guarded(async args => RemotePlayerProjectionSnapshot.parse(
      await handlers.snapshot(RemotePlayerProjectionSelection.parse(args)))),
    [methods.call]: guarded(args => {
      const operation = RemotePlayerProjectionCall.parse(args);
      if (!calls.has(operation.call)) throw new Error('remote call is unavailable');
      return handlers.call(operation);
    }),
    [methods.input]: guarded(async args => {
      const operation = RemotePlayerProjectionInput.parse(args);
      if (!inputs.has(operation.kind)) throw new Error('remote input is unavailable');
      await handlers.input(operation);
    }),
  };
  const port: PortServer = servePort(transport, Object.setPrototypeOf(operations, null));
  return {
    notify: (sender, notice) => port.notify(methods.notice, RemotePlayerProjectionNotice.parse({ sender, notice })),
    close: port.close,
  };
}
