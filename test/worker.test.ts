import { EventEmitter } from 'node:events';
import type { Worker as NodeWorker } from 'node:worker_threads';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { workerTransport } from '../src/worker.js';

// Compile against the actual Node and DOM worker shapes, without runtime casts.
const nodeCompatible: NodeWorker extends Parameters<typeof workerTransport>[0] ? true : false = true;
const webCompatible: Worker extends Parameters<typeof workerTransport>[0] ? true : false = true;

class NodeEndpoint extends EventEmitter {
  posted: unknown[] = [];
  terminated = 0;
  postMessage(value: unknown) { this.posted.push(value); }
  terminate() { this.terminated++; }
}
class WebEndpoint extends EventTarget {
  posted: unknown[] = [];
  terminated = 0;
  postMessage(value: unknown) { this.posted.push(value); }
  terminate() { this.terminated++; }
}

describe('worker transport', () => {
  it('accepts runtime worker types', () => {
    expect(nodeCompatible && webCompatible).toBe(true);
  });
  it('adapts Node message payloads and removes all event listeners on disposal', () => {
    const worker = new NodeEndpoint();
    const transport = workerTransport(worker);
    worker.emit('message', { type: 'ready' });
    const seen: unknown[] = [];
    transport.onMessage(value => seen.push(value));
    transport.send({ type: 'grant' });
    expect(seen).toEqual([{ type: 'ready' }]);
    expect(worker.posted).toEqual([{ type: 'grant' }]);
    transport.close(); transport.close();
    expect(worker.terminated).toBe(1);
    expect(worker.eventNames()).toEqual([]);
    expect(() => transport.send({})).toThrow('worker connection closed');
  });

  it('adapts EventTarget data and buffers an early ready until the bridge subscribes', () => {
    const worker = new WebEndpoint();
    const transport = workerTransport(worker);
    worker.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } }));
    const seen: unknown[] = [];
    const remove = transport.onMessage(value => seen.push(value));
    remove();
    worker.dispatchEvent(new MessageEvent('message', { data: { type: 'status', line: 'linked' } }));
    transport.onMessage(value => seen.push(value));
    expect(seen).toEqual([{ type: 'ready' }, { type: 'status', line: 'linked' }]);
    transport.close();
    worker.dispatchEvent(new MessageEvent('message', { data: 'after close' }));
    expect(seen).toHaveLength(2);
  });

  for (const event of ['error', 'messageerror', 'close']) {
    it(`reports a Web Worker ${event} event through the close lifecycle`, () => {
      const worker = new WebEndpoint();
      const transport = workerTransport(worker);
      const errors: Error[] = [];
      transport.onClose!(error => errors.push(error));
      worker.dispatchEvent(new Event(event));
      expect(errors).toHaveLength(1);
      expect(worker.terminated).toBe(1);
      const late: Error[] = [];
      transport.onClose!(error => late.push(error));
      expect(late).toEqual(errors);
    });
  }

  it('reports sanitized Node worker errors and rejected message sends', () => {
    const worker = new NodeEndpoint();
    const transport = workerTransport(worker);
    const errors: string[] = [];
    transport.onClose!(error => errors.push(error.message));
    worker.emit('error', new Error('synthetic internal detail'));
    expect(errors).toEqual(['worker connection failed']);
    const second = new NodeEndpoint();
    second.postMessage = () => { throw new Error('synthetic internal detail'); };
    const failed = workerTransport(second);
    expect(() => failed.send({})).toThrow('worker message could not be sent');
    expect(second.terminated).toBe(1);
  });
});

const script = fileURLToPath(new URL('../scripts/check-runtime-worker.mjs', import.meta.url));
const bun = spawnSync('bun', ['--version'], { encoding: 'utf8' });
describe('actual local runtime workers', () => {
  it('exchanges host messages and reports exit and error under Node', () => {
    const result = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8', timeout: 10000 }));
    expect(result).toMatchObject({ actualWorkers: 2, exchange: 'pass', exit: 'pass', failure: 'pass' });
  });
  it.skipIf(bun.status !== 0)('exchanges host messages and reports exit and error under Bun', () => {
    const result = JSON.parse(execFileSync('bun', [script], { encoding: 'utf8', timeout: 10000 }));
    expect(result).toMatchObject({ actualWorkers: 2, exchange: 'pass', exit: 'pass', failure: 'pass' });
    expect(result.runtime).toContain('Bun');
  });
});
