import { expect, it } from 'vitest';
import { AgentReply } from '../src/protocol.js';
const reply = { text: 'Which gate?', decision: { id: 'decision', text: 'Choose a gate.', choices: ['north', 'south'] } };
it('retains actual decision kind while accepting older replies without classification', () => {
  expect(AgentReply.parse(reply)).toEqual(reply);
  for (const kind of ['build', 'change', 'layout', 'pause', 'other']) expect(AgentReply.parse({ ...reply, decision: { ...reply.decision, kind } }).decision?.kind).toBe(kind);
});
it('refuses unknown classification rather than deriving question authority from prose', () => {
  expect(AgentReply.safeParse({ ...reply, decision: { ...reply.decision, kind: 'question' } }).success).toBe(false);
});
