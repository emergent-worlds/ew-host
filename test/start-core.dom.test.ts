// @vitest-environment jsdom
/** `startCore` on a page: a classic worker (no `type`) from a `blob:` holding the bootstrap (the App's request 9). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCore } from '../src/loader.js';
import { coreBootstrap } from '../src/start-core.js';

const createObjectURL = URL.createObjectURL;
afterEach(() => {
  vi.unstubAllGlobals();
  URL.createObjectURL = createObjectURL;
});

describe('startCore on a page (ew-host 0.3.3)', () => {
  it('starts a classic worker from a blob: bootstrap that imports the core by its absolute URL', async () => {
    const made: { url: string; options: unknown }[] = [];
    vi.stubGlobal(
      'Worker',
      class {
        constructor(url: string, options?: unknown) {
          made.push({ url, options });
        }
      },
    );
    let blob: Blob | undefined;
    URL.createObjectURL = (b: Blob) => ((blob = b), 'blob:null/1');
    startCore('./core.js');
    expect(made).toEqual([{ url: 'blob:null/1', options: undefined }]);
    expect(blob!.type).toBe('text/javascript');
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blob!);
    });
    expect(text).toBe(coreBootstrap(new URL('./core.js', location.href).href));
  });
});
