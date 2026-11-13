import { expect, it, vi } from 'vitest';
import { Manifest, splitInstalledPlayerTransport, type Transport } from '../src/index.js';

it('requires a web page and installed server before the native projection replaces a headless module', () => {
  const manifest = { name: 'Counter', kind: 'reality', version: '1.0.0', owner: '@mercerpress', asks: { players: 2 } };
  const entry = { web: 'page.html', installs: { server: 'build/server' } };
  expect(Manifest.safeParse({ ...manifest, entry }).success).toBe(false);
  expect(Manifest.safeParse({ ...manifest, entry: { ...entry, playerProjection: 'ew.remote-player.v1' } }).success).toBe(true);
  expect(Manifest.safeParse({ ...manifest, entry: { web: 'page.html', playerProjection: 'ew.remote-player.v1' } }).success).toBe(false);
  expect(Manifest.safeParse({ ...manifest, entry: { installs: entry.installs, playerProjection: 'ew.remote-player.v1' } }).success).toBe(false);
});

const coreFrame = { ew: 1, type: 'ready' };
const projectionFrame = { ew: 1, id: 1, call: 'ew.remote.describe' };
const tagged = { ewPlayerProjection: 1, frame: projectionFrame };

function socket(buffered: unknown[] = []) {
  let receive: (frame: unknown) => void = () => {};
  let lost: (error: Error) => void = () => {};
  const removeMessage = vi.fn(), removeClose = vi.fn();
  const transport: Transport = {
    send: vi.fn(),
    onMessage(listener) {
      receive = listener;
      for (const frame of buffered) listener(frame);
      return removeMessage;
    },
    onClose(listener) { lost = listener; return removeClose; },
    close: vi.fn(() => lost(new Error('underlying socket closed'))),
  };
  return { transport, receive: (frame: unknown) => receive(frame), lost: (error: Error) => lost(error), removeMessage, removeClose };
}

it('preserves raw core frames and delivers only strict tagged projection frames to the other lane', () => {
  const save = { ew: 1, type: 'save.request', reason: 'leaving' };
  const fixture = socket([coreFrame, tagged, save]);
  const { core, projection } = splitInstalledPlayerTransport(fixture.transport);
  const coreMessage = vi.fn(), projectionMessage = vi.fn();
  core.onMessage(coreMessage);
  projection.onMessage(projectionMessage);
  expect(coreMessage.mock.calls).toEqual([[coreFrame], [save]]);
  expect(projectionMessage).toHaveBeenCalledExactlyOnceWith(projectionFrame);
  core.send(coreFrame);
  projection.send(projectionFrame);
  expect(fixture.transport.send).toHaveBeenNthCalledWith(1, coreFrame);
  expect(fixture.transport.send).toHaveBeenNthCalledWith(2, tagged);
  core.close();
});

it('consumes a malformed marker, closes only projection and cleans up once when core closes', () => {
  const fixture = socket();
  const { core, projection } = splitInstalledPlayerTransport(fixture.transport);
  const coreMessage = vi.fn(), projectionMessage = vi.fn(), coreClosed = vi.fn(), projectionClosed = vi.fn();
  core.onMessage(coreMessage);
  projection.onMessage(projectionMessage);
  core.onClose!(coreClosed);
  projection.onClose!(projectionClosed);
  fixture.receive({ ...coreFrame, ewPlayerProjection: 2 });
  fixture.receive(tagged);
  fixture.receive(coreFrame);
  expect(coreMessage).toHaveBeenCalledExactlyOnceWith(coreFrame);
  expect(projectionMessage).not.toHaveBeenCalled();
  expect(projectionClosed).toHaveBeenCalledTimes(1);
  expect(() => projection.send(projectionFrame)).toThrow('invalid installed player projection frame');
  expect(coreClosed).not.toHaveBeenCalled();
  expect(fixture.transport.close).not.toHaveBeenCalled();
  core.close();
  core.close();
  expect(coreClosed).toHaveBeenCalledTimes(1);
  expect(projectionClosed).toHaveBeenCalledTimes(1);
  expect(fixture.transport.close).toHaveBeenCalledTimes(1);
  expect(fixture.removeMessage).toHaveBeenCalledTimes(1);
  expect(fixture.removeClose).toHaveBeenCalledTimes(1);
});

it('keeps explicit projection close local and propagates physical loss to the live core', () => {
  const fixture = socket();
  const { core, projection } = splitInstalledPlayerTransport(fixture.transport);
  const coreClosed = vi.fn(), projectionClosed = vi.fn();
  core.onClose!(coreClosed);
  projection.onClose!(projectionClosed);
  projection.close();
  expect(projectionClosed).toHaveBeenCalledTimes(1);
  core.send(coreFrame);
  expect(fixture.transport.send).toHaveBeenCalledExactlyOnceWith(coreFrame);
  const loss = new Error('socket lost');
  fixture.lost(loss);
  core.close();
  expect(coreClosed).toHaveBeenCalledExactlyOnceWith(loss);
  expect(projectionClosed).toHaveBeenCalledTimes(1);
  expect(fixture.transport.close).not.toHaveBeenCalled();
  expect(fixture.removeMessage).toHaveBeenCalledTimes(1);
  expect(fixture.removeClose).toHaveBeenCalledTimes(1);
});
