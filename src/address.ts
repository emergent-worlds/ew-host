/** E10: a registry key only. Parsing performs no DNS lookup or network operation. */
export function serverAddress(value: string): string {
  const input = value.trim();
  const match = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(?::([0-9]+))?$/.exec(input);
  if (!match || input.length > 261) throw new Error('invalid server address');
  const host = match[1]!.toLowerCase(), port = match[2] === undefined ? 7420 : Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid server address');
  if (!host.startsWith('[') && (host.length > 253 || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) throw new Error('invalid server address');
  let parsed: URL;
  try { parsed = new URL(`ws://${host}:${port}`); } catch { throw new Error('invalid server address'); }
  // URL's legacy numeric-host rewrites must not silently identify another endpoint.
  if (!host.startsWith('[') && parsed.hostname !== host) throw new Error('invalid server address');
  return `${parsed.hostname}:${port}`;
}
