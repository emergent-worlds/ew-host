/**
 * The platform is model agnostic (the operator, 2026-10-15): no model or provider
 * is named in this repository's code. Every choice of model comes from the
 * platform's catalogue and the person's settings. This test reads every file under
 * `src/`, `test/`, and `scripts/` (this file excepted) and fails on any name below.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SELF = fileURLToPath(import.meta.url);
const DIRS = ['src', 'test', 'scripts'];
const NAMES = ['anthropic', 'openai', 'deepseek', 'google', 'gemini', 'imagen', 'vertex', 'claude', 'gpt-', 'haiku', 'sonnet', 'opus', 'kimi', 'moonshot', 'mistral', 'llama', 'qwen', 'grok'];
const PATTERN = new RegExp(NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|'), 'i');

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('model agnostic', () => {
  it('names no model or provider in src, test, or scripts', () => {
    const found: string[] = [];
    for (const file of DIRS.flatMap((d) => files(join(ROOT, d)))) {
      if (resolve(file) === SELF) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const m = PATTERN.exec(line);
          if (m) found.push(`${relative(ROOT, file)}:${i + 1}: "${m[0]}" in ${line.trim().slice(0, 160)}`);
        });
    }
    expect(found, `model or provider names found:\n${found.join('\n')}`).toEqual([]);
  });
});
