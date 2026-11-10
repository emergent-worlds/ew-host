import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { expect, it, vi } from 'vitest';
import {
  callPort, REMOTE_PLAYER_PROJECTION_METHODS as methods, RemotePlayerProjectionDescriptor,
  RemotePlayerProjectionSnapshot, serveRemotePlayerProjection, type Transport,
} from '../src/index.js';

function transport(port: MessagePort): Transport {
  return {
    send: message => port.postMessage(message),
    onMessage(listener) {
      port.on('message', listener);
      return () => { port.off('message', listener); };
    },
    close: () => port.close(),
  };
}

it('serves a strict per-player projection across a separate MessagePort', async () => {
  const channel = new MessageChannel();
  const peer = callPort(transport(channel.port1));
  const descriptor = RemotePlayerProjectionDescriptor.parse({ protocol: 'ew.remote-player.v1', calls: ['yard.view'], inputs: ['text'] });
  const player = { sender: 'first-slot', handle: '@crowsfeather', host: false };
  const projection = { ew: 1 as const, notice: 'yard.view', data: { day: 1 } };
  const game = {
    admit: vi.fn(),
    snapshot: vi.fn(() => [projection]),
    call: vi.fn(() => ({ day: 1 })),
    input: vi.fn(),
  };
  const service = serveRemotePlayerProjection(transport(channel.port2), descriptor, game);
  try {
    expect(await peer.call(methods.describe)).toEqual(descriptor);
    await expect(peer.call(methods.admit, { ...player, accountId: 'private' })).rejects.toThrow('refused');
    expect(game.admit).not.toHaveBeenCalled();
    await peer.call(methods.admit, player);
    expect(game.admit).toHaveBeenCalledExactlyOnceWith(player);
    expect(await peer.call(methods.snapshot, { sender: player.sender })).toEqual([projection]);
    expect(await peer.call(methods.call, { sender: player.sender, call: 'yard.view' })).toEqual({ day: 1 });
    await expect(peer.call(methods.call, { sender: player.sender, call: 'yard.edit' })).rejects.toThrow('refused');
    await expect(peer.call(methods.call, { sender: player.sender, call: 'state.read' })).rejects.toThrow('refused');
    expect(game.call).toHaveBeenCalledExactlyOnceWith({ sender: player.sender, call: 'yard.view' });
    await expect(peer.call(methods.input, { sender: player.sender, kind: 'pointer', data: {} })).rejects.toThrow('refused');
    await expect(peer.call(methods.input, { sender: player.sender, kind: 'text' })).rejects.toThrow('refused');
    await peer.call(methods.input, { sender: player.sender, kind: 'text', data: 'check the yard' });
    expect(game.input).toHaveBeenCalledExactlyOnceWith({ sender: player.sender, kind: 'text', data: 'check the yard' });
    expect(() => service.notify(player.sender, { ew: 1, notice: 'ew.remote.capabilities' })).toThrow('reserved remote notice');
    const delivered = new Promise(resolve => peer.on(methods.notice, resolve));
    service.notify(player.sender, projection);
    expect(await delivered).toEqual({ sender: player.sender, notice: projection });
  } finally {
    peer.close();
    service.close();
  }
});

it('rejects reserved and repeated capabilities and oversized snapshots', () => {
  const descriptor = { protocol: 'ew.remote-player.v1', calls: [], inputs: [] };
  for (const call of ['ew.remote.describe', 'file.read', 'state.read', 'model.call', 'agent.ask', 'prefs.set',
    'app.open', 'layout.set', 'load', 'save', 'advance', 'change', 'query']) {
    expect(RemotePlayerProjectionDescriptor.safeParse({ ...descriptor, calls: [call] }).success).toBe(false);
  }
  expect(RemotePlayerProjectionDescriptor.safeParse({ ...descriptor, calls: ['yard.view', 'yard.view'] }).success).toBe(false);
  expect(RemotePlayerProjectionDescriptor.safeParse({ ...descriptor, inputs: ['text', 'text'] }).success).toBe(false);
  expect(RemotePlayerProjectionSnapshot.safeParse([{ ew: 1, notice: 'ew.remote.capabilities' }]).success).toBe(false);
  expect(RemotePlayerProjectionSnapshot.safeParse(Array.from({ length: 1001 }, () => ({ ew: 1, notice: 'yard.view' }))).success).toBe(false);
});
