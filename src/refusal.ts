/** Structured refusals on the privileged host contract. No model policy is inferred here. */
import { z } from 'zod';

type RefusalJson = string | number | boolean | null | RefusalJson[] | { [key: string]: RefusalJson };
function jsonValue(value: unknown): boolean {
  const active = new Set<object>(); const stack: { value: unknown; exit?: boolean }[] = [{ value }];
  while (stack.length) {
    const next = stack.pop()!; const part = next.value;
    if (next.exit) { active.delete(part as object); continue; }
    if (part === null || typeof part === 'string' || typeof part === 'boolean' || (typeof part === 'number' && Number.isFinite(part))) continue;
    if (!part || typeof part !== 'object' || active.has(part)) return false;
    if (!Array.isArray(part) && Object.getPrototypeOf(part) !== Object.prototype && Object.getPrototypeOf(part) !== null) return false;
    active.add(part); stack.push({ value: part, exit: true });
    for (const child of Array.isArray(part) ? part : Object.values(part)) stack.push({ value: child });
  }
  return true;
}
export const RefusalDetail = z.record(z.unknown()).refine(jsonValue, 'refusal detail is JSON').transform(value => value as Record<string, RefusalJson>);
export type RefusalDetail = z.infer<typeof RefusalDetail>;
function detail(value: unknown): RefusalDetail | undefined {
  try { const parsed = RefusalDetail.safeParse(value); return parsed.success ? JSON.parse(JSON.stringify(parsed.data)) as RefusalDetail : undefined; }
  catch { return undefined; }
}

export class HostRefusal extends Error {
  readonly code: string | undefined;
  readonly detail: RefusalDetail | undefined;
  constructor(code: string | undefined, message: string, data?: Record<string, unknown>) {
    super(message); this.name = 'HostRefusal'; this.code = code || undefined; this.detail = detail(data);
  }
}
export { HostRefusal as HostRefusalError };
export interface RefusalFields { error: string; code?: string; detail?: RefusalDetail }

/** Only explicitly supplied code/detail are preserved; arbitrary exception properties are not serialized. */
export function refusalFields(error: unknown): RefusalFields {
  if (typeof error === 'string') return { error };
  let message = 'the request was refused'; let code: string | undefined; let data: RefusalDetail | undefined;
  try {
    if (error && typeof error === 'object') {
      const candidate = error as { message?: unknown; code?: unknown; detail?: unknown };
      if (typeof candidate.message === 'string') message = candidate.message;
      if (typeof candidate.code === 'string' && candidate.code) code = candidate.code;
      data = detail(candidate.detail);
    }
  } catch { /* A malformed exception must not prevent its refusal from reaching the caller. */ }
  return { error: message, ...(code === undefined ? {} : { code }), ...(data === undefined ? {} : { detail: data }) };
}
export function refusalError(reply: { error?: string; code?: string; detail?: RefusalDetail }, fallback: string): Error {
  return reply.code !== undefined || reply.detail !== undefined ? new HostRefusal(reply.code, reply.error ?? fallback, reply.detail) : new Error(reply.error ?? fallback);
}
