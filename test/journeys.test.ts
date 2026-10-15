// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { answerFrameRequest, frameQuery } from '../src/journeys.js';

beforeAll(() => {
  // jsdom lays nothing out; every element is given a size so it counts as visible.
  Element.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, toJSON: () => ({}) }) as DOMRect;
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML = `
    <section data-board="FirstMoment">
      <p>You are the harbormaster of Salt Harbor.</p>
      <label>your line <input aria-label="your line" /></label>
      <button data-ew="Button">start</button>
      <button data-ew="Button" disabled>leave</button>
    </section>`;
});

describe('the journeys hooks inside a Reality page (ew-host 0.3.0)', () => {
  it('finds, types, clicks, and reads by the App seam selector', async () => {
    expect(frameQuery({ board: 'FirstMoment', part: 'Button', text: 'start' })).toHaveLength(1);
    let pressed = 0;
    document.querySelector('button')!.addEventListener('click', () => pressed++);
    await answerFrameRequest('type', { board: 'FirstMoment', label: 'your line', value: 'ring the harbour bell' });
    expect((await answerFrameRequest('read', { board: 'FirstMoment', label: 'your line' })) as { value: string }).toMatchObject({ value: 'ring the harbour bell' });
    await answerFrameRequest('click', { board: 'FirstMoment', part: 'Button', text: 'start' });
    expect(pressed).toBe(1);
    await expect(answerFrameRequest('click', { board: 'FirstMoment', part: 'Button', text: 'leave' })).rejects.toThrow('disabled');
    expect((await answerFrameRequest('screen', {})) as { board: string }).toMatchObject({ board: 'FirstMoment' });
    let entered = '';
    const field = document.querySelector('input')!;
    field.addEventListener('keydown', (e) => (entered = (e as KeyboardEvent).key));
    field.focus();
    await answerFrameRequest('key', { key: 'Enter' });
    expect(entered).toBe('Enter');
    entered = '';
    (document.activeElement as HTMLElement | null)?.blur();
    await answerFrameRequest('key', { key: 'Enter', board: 'FirstMoment', label: 'your line' });
    expect(entered).toBe('Enter');
  });
  it('never names a typed value in an error', async () => {
    await expect(answerFrameRequest('type', { board: 'Nowhere', label: 'your line', value: 'a secret line' })).rejects.toThrow(/^(?!.*a secret line)/);
  });
});
