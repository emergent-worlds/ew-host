/**
 * The journeys' hooks inside a Reality's page (the plan, Section 6; the App's request 6, 2026-10-15).
 *
 * The host contract ends in the folder's core, which runs in a worker and has no page, so the
 * journeys cannot drive a pack's screens over it. A page calls `installJourneysHooks()` once; the
 * hooks answer only when the App handed the frame its port with `journeys: true` (a journeys build),
 * and only to the parent window. They find, click, type, wait for, and read the page's own elements
 * with the same selector the App's seam takes (board, part, row, label, text, nth), so one script
 * drives the App and the pack alike. Errors never repeat a typed value: runs write them to events.
 */

/** A selector, as the App's seam takes it. */
export interface FrameSelector {
  board?: string;
  part?: string;
  row?: string;
  label?: string;
  text?: string;
  nth?: number;
}

/** What the parent sends: `{ ewSeam: 1, id, method, params }`; the answer is `{ ewSeam: 1, reply_to, ok, result | error }`. */
export type FrameMethod = 'find' | 'click' | 'type' | 'key' | 'wait' | 'read' | 'screen';

const collapse = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
/** CSS.escape where the page has it; a quote-and-backslash escape where it does not. */
const esc = (v: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&'));

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const st = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && (st.opacity === '' || Number(st.opacity) > 0);
}

function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return collapse(aria);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    if (el.labels?.[0]) return collapse([...el.labels[0].childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' '));
    if (!(el instanceof HTMLSelectElement) && el.placeholder) return collapse(el.placeholder);
  }
  return '';
}

const clickable = (el: Element) => el.closest('button, a, input, select, textarea, label, [role="button"], [onclick]') ?? el;
const disabled = (el: Element) => {
  const c = clickable(el);
  return !!(c as HTMLButtonElement).disabled || c.getAttribute('aria-disabled') === 'true';
};

function describe(el: Element) {
  const r = el.getBoundingClientRect();
  return {
    board: el.closest('[data-board]')?.getAttribute('data-board') ?? null,
    part: el.closest('[data-ew]')?.getAttribute('data-ew') ?? null,
    tag: el.tagName.toLowerCase(),
    text: collapse(el.textContent),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    visible: visible(el),
    enabled: !disabled(el),
  };
}

/** The elements a selector names, in document order, visible only. */
export function frameQuery(s: FrameSelector, root: ParentNode = document): Element[] {
  let scope: ParentNode = root;
  if (s.board) {
    const b = root.querySelector(`[data-board="${esc(s.board)}"]`);
    if (!b) return [];
    scope = b;
  }
  if (s.row) {
    const r = scope.querySelector(`[data-row="${esc(s.row)}"]`);
    if (!r) return [];
    scope = r;
  }
  const parts = s.part ? [...scope.querySelectorAll(`[data-ew="${esc(s.part)}"]`)] : null;
  let els: Element[] = parts ? (s.text || s.label ? parts.flatMap((p) => [p, ...p.querySelectorAll('*')]) : parts) : s.board && !s.text && !s.label ? [scope as Element] : [...scope.querySelectorAll('*')];
  if (s.text) {
    const t = collapse(s.text);
    els = els.filter((e) => collapse(e.textContent).includes(t));
    els = els.filter((e) => ![...e.children].some((c) => collapse(c.textContent).includes(t)));
    const exact = els.filter((e) => collapse(e.textContent) === t);
    if (exact.length) els = exact;
  }
  if (s.label) {
    const l = collapse(s.label);
    els = els.filter((e) => accessibleName(e) === l || ((e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement) && collapse(e.labels?.[0]?.textContent) === l));
  }
  els = els.filter(visible);
  return s.nth !== undefined ? els.slice(s.nth, s.nth + 1) : els;
}

const shown = (s: FrameSelector) => JSON.stringify({ board: s.board, part: s.part, row: s.row, label: s.label, text: s.text, nth: s.nth });

function one(s: FrameSelector): Element {
  const el = frameQuery(s)[0];
  if (!el) throw new Error(`nothing in the frame matches ${shown(s)}`);
  return el;
}

function press(el: Element) {
  const c = clickable(el);
  if (disabled(c)) throw new Error(`the control is disabled: ${collapse(c.textContent)}`);
  c.scrollIntoView({ block: 'center', inline: 'center' });
  const r = c.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0 };
  // A pointer event where the page has one (every browser; not every test page).
  const Pointer = typeof PointerEvent === 'undefined' ? MouseEvent : PointerEvent;
  c.dispatchEvent(new Pointer('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }));
  c.dispatchEvent(new MouseEvent('mousedown', opts));
  if (c instanceof HTMLElement) c.focus();
  c.dispatchEvent(new Pointer('pointerup', { ...opts, pointerType: 'mouse', isPrimary: true }));
  c.dispatchEvent(new MouseEvent('mouseup', opts));
  c.dispatchEvent(new MouseEvent('click', opts));
}

function enter(el: Element, text: string, replace: boolean) {
  const select = (el.closest('select') ?? el.querySelector('select')) as HTMLSelectElement | null;
  if (select) {
    const opt = [...select.options].find((o) => collapse(o.textContent) === collapse(text) || o.value === text);
    if (!opt) throw new Error(`the select "${accessibleName(select)}" has no option for the value typed`);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, opt.value);
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const input = (el.closest('input, textarea') ?? el.querySelector('input, textarea')) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!input) throw new Error('not a field');
  input.focus();
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, (replace ? '' : input.value) + text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function wait(s: FrameSelector & { gone?: boolean; timeoutMs?: number }) {
  const until = performance.now() + (s.timeoutMs ?? 10_000);
  for (;;) {
    const found = frameQuery(s);
    if (s.gone ? found.length === 0 : found.length > 0) return { found: found.map(describe) };
    if (performance.now() > until) throw new Error(`${s.gone ? 'still there' : 'never appeared'} in the frame: ${shown(s)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function screen() {
  const boards = [...document.querySelectorAll('[data-board]')].filter(visible);
  const root = boards[boards.length - 1] ?? null;
  const texts: string[] = [];
  const walker = document.createTreeWalker(root ?? document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = collapse(n.textContent);
    if (t && n.parentElement && visible(n.parentElement)) texts.push(t);
  }
  return { board: root?.getAttribute('data-board') ?? null, parts: [...(root ?? document).querySelectorAll('[data-ew]')].filter(visible).map((e) => e.getAttribute('data-ew')!), texts };
}

/** Answers one request; exported for tests. */
export async function answerFrameRequest(method: FrameMethod, params: FrameSelector & { value?: string; replace?: boolean; gone?: boolean; timeoutMs?: number; key?: string }): Promise<unknown> {
  switch (method) {
    case 'find':
      return { found: frameQuery(params).map(describe) };
    case 'click':
      press(one(params));
      return { ok: true };
    case 'type':
      enter(one(params), params.value ?? '', params.replace ?? true);
      return { ok: true };
    case 'key': {
      // A key pressed on the focused element, as a person presses it (Enter sends a typed line).
      const el = (document.activeElement ?? document.body) as HTMLElement;
      const key = params.key ?? 'Enter';
      for (const t of ['keydown', 'keypress', 'keyup'] as const) el.dispatchEvent(new KeyboardEvent(t, { key, code: key, bubbles: true, cancelable: true }));
      if (key === 'Enter' && el instanceof HTMLInputElement) el.form?.requestSubmit();
      return { ok: true };
    }
    case 'wait':
      return wait(params);
    case 'read': {
      const el = one(params);
      return { text: collapse(el.textContent), value: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value : null };
    }
    case 'screen':
      return screen();
  }
}

let installed = false;

/**
 * Installs the hooks: they answer the parent window only, and only once the App's handoff of the
 * frame's port said `journeys: true`. Call it once, at the page's start, before `framePort()`.
 */
export function installJourneysHooks(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  let enabled = false;
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const d = e.data as { ewHost?: unknown; journeys?: unknown; ewSeam?: unknown; id?: unknown; method?: unknown; params?: unknown };
    if (d?.ewHost === 1 && d.journeys === true) enabled = true;
    if (d?.ewSeam !== 1 || !enabled || typeof d.id !== 'number' || typeof d.method !== 'string') return;
    const reply = (body: object) => window.parent.postMessage({ ewSeam: 1, reply_to: d.id, ...body }, '*');
    answerFrameRequest(d.method as FrameMethod, (d.params ?? {}) as FrameSelector).then(
      (result) => reply({ ok: true, result }),
      (err: unknown) => reply({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  });
}
