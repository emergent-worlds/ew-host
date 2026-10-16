import { expect, it } from 'vitest';
import { serverAddress } from '../src/address.js';
it('canonicalizes registry hosts and the recorded default port without resolving them', () => {
  expect(serverAddress(' SALT-HARBOR.example:07420 ')).toBe('salt-harbor.example:7420');
  expect(serverAddress('203.0.113.24')).toBe('203.0.113.24:7420');
  expect(serverAddress('[2001:0db8::1]:443')).toBe('[2001:db8::1]:443');
  expect(serverAddress('localhost')).toBe('localhost:7420');
});
it('rejects URL authority tricks, ambiguous numeric hosts and invalid ports', () => {
  for (const address of ['http://example.test', 'ws://example.test:7420', 'user@example.test:7420', 'example.test/path', 'example.test?x', 'example.test#x', 'example.test\\x', 'example%2etest', '127.1', '0177.0.0.1', '0x7f000001', '2130706433', 'example.test:0', 'example.test:65536', 'example.test:-1', 'example.test:', '[::1%25lo]:7420', '::1', '-bad.test', 'bad..test', 'bad.test.', 'a'.repeat(64)+'.test', 'a b.test']) expect(() => serverAddress(address), address).toThrow();
});
