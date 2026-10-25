import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeOpenerAdapter, OpenerRequestSchema, describeOpenerContext, handleOpenerRequest, toOpener } from '../dist/index.js';

const input = OpenerRequestSchema.parse({
  candidate: { viaName: 'Sam', hops: 2, mutualCount: 1, sharedTags: ['climbing'], area: 'austin' },
  sender: { bio: 'New in town', interests: ['climbing'], homeArea: 'austin' },
});

function fakeClient(reply) {
  const calls = [];
  return { calls, beta: { messages: { parse: async (args) => { calls.push(args); return reply; } } } };
}

test('context carries only card fields and the sender profile', () => {
  const ctx = describeOpenerContext(input);
  assert.match(ctx, /Sam \(a friend of yours\) knows them directly/);
  assert.match(ctx, /shared interests: climbing/);
});

test('request schema rejects extra fields', () => {
  assert.equal(OpenerRequestSchema.safeParse({ ...input, candidate: { ...input.candidate, name: 'Riya' } }).success, false);
});

test('adapter caches the system prompt and returns a cleaned draft', async () => {
  const client = fakeClient({ stop_reason: 'end_turn', usage: { cache_read_input_tokens: 900 },
    parsed_output: { message: '  Hey!  Sam said you climb. ', angle: 'shared_interest', suggestion: 'Bouldering' } });
  const out = await new ClaudeOpenerAdapter({ client }).draft(input);
  assert.deepEqual(out, { message: 'Hey! Sam said you climb.', angle: 'shared_interest', suggestion: 'Bouldering' });
  const [args] = client.calls;
  assert.equal(args.model, 'claude-opus-5-5');
  assert.deepEqual(args.system[0].cache_control, { type: 'ephemeral' });
});

test('refusal and empty output become provider errors', async () => {
  await assert.rejects(new ClaudeOpenerAdapter({ client: fakeClient({ stop_reason: 'refusal', usage: {} }) }).draft(input), /refused/);
  assert.throws(() => toOpener({ message: '   ', angle: 'mutual_friend', suggestion: '' }), /invalid_output/);
  assert.equal(toOpener({ message: 'x'.repeat(300), angle: 'mutual_friend', suggestion: '' }).message.length, 200);
});

test('route requires sign-in and a valid body', async () => {
  const opener = { draft: async () => ({ message: 'hi', angle: 'mutual_friend', suggestion: '' }) };
  const req = (body) => new Request('http://x/api/network/opener', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  assert.equal((await handleOpenerRequest(req(input), { session: { configured: true, userId: null }, opener })).status, 401);
  assert.equal((await handleOpenerRequest(req({}), { session: { configured: true, userId: 'u' }, opener })).status, 422);
  const ok = await handleOpenerRequest(req(input), { session: { configured: true, userId: 'u' }, opener });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).message, 'hi');
});
