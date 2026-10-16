// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { framePorts } from '../src/loader.js';

it('takes both ports together only from the parent and only when both are present', async () => {
  const core = {} as MessagePort; const page = {} as MessagePort;
  const result = framePorts(100);
  window.dispatchEvent(new MessageEvent('message', { source: null, data: { ewHost: 1 }, ports: [core, page] }));
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { ewHost: 1 }, ports: [core] }));
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: { ewHost: 1 }, ports: [core, page] }));
  await expect(result).resolves.toEqual({ core, page });
});
