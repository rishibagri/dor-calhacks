import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { PrivateReflectionSchema, VoiceSessionSchema } from '@dor/contracts';
import { CartesiaVoiceAdapter, ClaudeReflectionAdapter, ProviderError, sniffAudioExtension } from '../dist/index.js';
import { REFLECTION_SYSTEM_PROMPT } from '../dist/reflection/prompt.js';

const json = async (url) => JSON.parse(await readFile(new URL(url, import.meta.url), 'utf8'));
const reflections = await json('../fixtures/reflection.synthetic.json');
const voice = await json('../fixtures/voice.synthetic.json');
const code = (c) => (e) => e instanceof ProviderError && e.code === c;

function claudeStub(respond) {
  const calls = [];
  return { calls, client: { beta: { messages: { parse: async (params) => { calls.push(params); return respond(params); } } } } };
}
const parsed = (parsed_output, stop_reason = 'end_turn') => ({ stop_reason, parsed_output, content: [] });
const CONNECT = { intent: 'wants_connection', risk: 'none', mentionedNames: [], excludedNames: [], preferredNames: [] };

test('reflection fixtures satisfy the C1 contract and their own expectations', () => {
  for (const c of reflections.cases) {
    const output = PrivateReflectionSchema.parse(c.output);
    if ('candidate' in c.expect) assert.deepEqual(output.candidate, c.expect.candidate, c.id);
    if (c.expect.reflectionMentionsCrisisSupport) assert.match(output.reflection, /988|emergency|crisis/i);
    if ('assessment' in c.expect) assert.deepEqual(output.assessment, c.expect.assessment, c.id);
    if (c.expect.reflectionMentionsCrisisSupport) assert.equal(output.assessment?.intent, 'wants_space', `${c.id}: crisis suggests nothing`);
    // Private-party case: nothing owner-facing hints at the event, the excuse, timing or "ask about".
    if (c.expect.noEventOrTimingCopy) {
      assert.doesNotMatch(output.reflection, /party|friday|sick|ask about|jordan/i, c.id);
      assert.deepEqual([...output.assessment.excludedNames, ...output.assessment.preferredNames], [], `${c.id}: no inferred names`);
    }
  }
});

test('Claude reflection: request shape carries the selected text only, with fallback and low effort', async () => {
  const { calls, client } = claudeStub(() => parsed({ reflection: ' A synthetic reflection. ',
    candidate: { supportMode: 'short_call', availability: null }, assessment: CONNECT }));
  const result = await new ClaudeReflectionAdapter({ client }).reflect('  SYNTHETIC entry  ', 'req-1');
  assert.deepEqual(result, { schemaVersion: 1, reflection: 'A synthetic reflection.', candidate: { supportMode: 'short_call' },
    assessment: CONNECT });
  const [request] = calls;
  assert.equal(request.model, 'claude-opus-5-5');
  assert.deepEqual(request.messages, [{ role: 'user', content: 'SYNTHETIC entry' }]);
  assert.equal(request.fallbacks, 'default');
  assert.deepEqual(request.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(request.output_config.effort, 'low');
  assert.ok(request.output_config.format, 'structured output format is set');
  assert.equal(request.metadata, undefined, 'no user identifiers are sent');
  assert.equal(JSON.stringify(request).includes('req-1'), false, 'request ID stays local');
});

test('Claude reflection: an all-null candidate becomes no candidate', async () => {
  const { client } = claudeStub(() => parsed({ reflection: 'Rest well.', candidate: { supportMode: null, availability: null } }));
  assert.equal((await new ClaudeReflectionAdapter({ client }).reflect('SYNTHETIC', 'r')).candidate, null);
});

test('Claude reflection: refusals, truncation, oversize output and bad input fail with sanitized codes', async () => {
  const run = (response, text = 'SYNTHETIC') => new ClaudeReflectionAdapter({ client: claudeStub(() => response).client }).reflect(text, 'r');
  await assert.rejects(run(parsed(null, 'refusal')), code('refused'));
  await assert.rejects(run(parsed(null, 'max_tokens')), code('invalid_output'));
  await assert.rejects(run(parsed({ reflection: 'x'.repeat(2001), candidate: null })), code('invalid_output'));
  const { calls, client } = claudeStub(() => parsed({ reflection: 'r', candidate: null }));
  const adapter = new ClaudeReflectionAdapter({ client });
  await assert.rejects(adapter.reflect('   ', 'r'), code('invalid_input'));
  await assert.rejects(adapter.reflect('x'.repeat(8001), 'r'), code('invalid_input'));
  assert.equal(calls.length, 0);
});

test('Claude reflection: SDK errors map by status and never carry the provider message', async () => {
  const error = new Anthropic.RateLimitError(429, { type: 'error' }, 'SYNTHETIC body echo', new Headers());
  const { client } = claudeStub(() => { throw error; });
  await assert.rejects(new ClaudeReflectionAdapter({ client }).reflect('SYNTHETIC', 'r'),
    (e) => code('rate_limited')(e) && !e.message.includes('SYNTHETIC') && e.cause === undefined);
});

test('Claude reflection: missing credentials report not_configured', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(new ClaudeReflectionAdapter().reflect('SYNTHETIC', 'r'), code('not_configured'));
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

function cartesiaStub(overrides = {}) {
  const calls = { token: [], stt: [], tts: [] };
  const client = {
    accessToken: { create: async (body) => { calls.token.push(body); return { token: 'synthetic-scoped-token' }; } },
    stt: { transcribe: async (params) => { calls.stt.push(params); return { type: 'transcript', text: ' synthetic words ' }; } },
    tts: { generate: async (params) => { calls.tts.push(params); return new Response(new Uint8Array([82, 73, 70, 70])); } },
    ...overrides,
  };
  return { calls, client };
}
const wavHeader = () => new Uint8Array([...'RIFF'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WAVE'].map(c => c.charCodeAt(0)), [0, 0, 0, 0]));

test('voice fixtures satisfy the C1 VoiceSession contract', () => {
  VoiceSessionSchema.parse(voice.session);
});

test('Cartesia session: scoped 60s token, never the master key', async () => {
  const { calls, client } = cartesiaStub();
  const adapter = new CartesiaVoiceAdapter({ client, apiKey: 'sk_car_SYNTHETIC_MASTER', now: () => new Date('2026-10-24T00:00:00Z') });
  const session = await adapter.createSession('r');
  VoiceSessionSchema.parse(session);
  assert.deepEqual(calls.token, [{ grants: { stt: true, tts: true }, expires_in: 60 }]);
  assert.equal(session.expiresAt, '2026-10-24T00:01:00.000Z');
  assert.equal(JSON.stringify(session).includes('sk_car_SYNTHETIC_MASTER'), false);
  await assert.rejects(new CartesiaVoiceAdapter({ client, tokenTtlSeconds: 3600 }).createSession('r'), code('invalid_input'));
});

test('Cartesia TTS: save is disabled and input is bounded', async () => {
  const { calls, client } = cartesiaStub();
  const adapter = new CartesiaVoiceAdapter({ client });
  const out = await adapter.synthesize(' SYNTHETIC hello ', 'r');
  assert.equal(out.mimeType, 'audio/wav');
  assert.equal(out.audio.byteLength, 4);
  assert.equal(calls.tts[0].save, false);
  assert.equal(calls.tts[0].transcript, 'SYNTHETIC hello');
  assert.deepEqual(calls.tts[0].output_format, { container: 'wav', encoding: 'pcm_s16le', sample_rate: 24000 });
  await assert.rejects(adapter.synthesize('x'.repeat(1001), 'r'), code('invalid_input'));
  assert.equal(calls.tts.length, 1);
});

test('Cartesia STT: only recognized audio containers are uploaded', async () => {
  const { calls, client } = cartesiaStub();
  const adapter = new CartesiaVoiceAdapter({ client });
  assert.deepEqual(await adapter.transcribe(wavHeader(), 'r'), { text: 'synthetic words' });
  assert.equal(calls.stt[0].model, 'ink-whisper');
  assert.equal(calls.stt[0].file.name, 'clip.wav');
  await assert.rejects(adapter.transcribe(new TextEncoder().encode('SYNTHETIC not audio at all'), 'r'), code('invalid_input'));
  assert.equal(calls.stt.length, 1);
  assert.equal(sniffAudioExtension(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), 'webm');
});

test('Cartesia errors map to sanitized codes; missing key reports not_configured', async () => {
  const failing = (error) => new CartesiaVoiceAdapter({ client: cartesiaStub({ accessToken: { create: async () => { throw error; } } }).client });
  await assert.rejects(failing({ name: 'APIConnectionTimeoutError' }).createSession('r'), code('timeout'));
  await assert.rejects(failing({ status: 401, message: 'SYNTHETIC' }).createSession('r'), code('auth_failed'));
  await assert.rejects(failing({ status: 500 }).createSession('r'), code('unavailable'));
  const saved = process.env.CARTESIA_API_KEY;
  delete process.env.CARTESIA_API_KEY;
  try {
    await assert.rejects(new CartesiaVoiceAdapter().createSession('r'), code('not_configured'));
  } finally {
    if (saved !== undefined) process.env.CARTESIA_API_KEY = saved;
  }
});

test('claude usage: metadata only, reported for success and for every failure path', async () => {
  const seen = [];
  const usage = { input_tokens: 812, output_tokens: 96, cache_read_input_tokens: 700 };
  const ok = claudeStub(() => ({ stop_reason: 'end_turn', usage,
    parsed_output: { reflection: 'SYNTHETIC reflection', candidate: { supportMode: 'short_call', availability: null },
      assessment: { intent: 'wants_connection', risk: 'none', mentionedNames: [], excludedNames: [], preferredNames: [] } } }));
  await new ClaudeReflectionAdapter({ client: ok.client, onUsage: u => seen.push(u) }).reflect('SYNTHETIC secret', 'req-1');
  const cut = claudeStub(() => ({ stop_reason: 'max_tokens', usage, parsed_output: null }));
  await assert.rejects(new ClaudeReflectionAdapter({ client: cut.client, onUsage: u => seen.push(u) }).reflect('SYNTHETIC', 'r'));
  assert.deepEqual(seen.map(({ durationMs, ...rest }) => rest), [
    { model: 'claude-opus-5-5', outcome: 'ok', candidate: true, inputTokens: 812, outputTokens: 96, cacheReadTokens: 700 },
    { model: 'claude-opus-5-5', outcome: 'invalid_output', candidate: null, inputTokens: 812, outputTokens: 96, cacheReadTokens: 700 },
  ]);
  assert.ok(seen.every(u => Number.isInteger(u.durationMs)));
  assert.doesNotMatch(JSON.stringify(seen), /SYNTHETIC|req-1/, 'no text or request IDs in usage');
});

test('D040 assessment repair: whitespace and case duplicates fixed; overlap drops the preference; anything unsafe suggests nothing', async () => {
  const { toPrivateAssessment } = await import('../dist/index.js');
  const NOTHING = { intent: 'wants_space', risk: 'interpersonal_conflict', mentionedNames: [], excludedNames: [], preferredNames: [] };
  assert.deepEqual(toPrivateAssessment({ intent: 'wants_connection', risk: 'none', mentionedNames: ['Sam'], excludedNames: [' Alex ', 'alex'], preferredNames: ['Sam', 'ALEX'] }),
    { intent: 'wants_connection', risk: 'none', mentionedNames: ['Sam'], excludedNames: ['Alex'], preferredNames: ['Sam'] }, 'an exclusion always wins over a preference');
  assert.deepEqual(toPrivateAssessment(undefined), NOTHING, 'missing assessment = suggest nothing');
  assert.deepEqual(toPrivateAssessment({ intent: 'unclear', excludedNames: ['A', 'B', 'C', 'D', 'E', 'F'], preferredNames: [] }), NOTHING,
    'cannot keep every veto → suggest nothing, never drop one');
  assert.deepEqual(toPrivateAssessment({ intent: 'wants_connection', excludedNames: ['Al\u202Eex'], preferredNames: [] }), NOTHING);
  assert.deepEqual(toPrivateAssessment({ intent: 'send_now', excludedNames: [], preferredNames: [] }), NOTHING);
  assert.equal(toPrivateAssessment({ intent: 'wants_connection', excludedNames: ['x'.repeat(60)], preferredNames: [] }).excludedNames[0].length, 40);
  assert.equal(toPrivateAssessment({ intent: 'unclear', excludedNames: [], preferredNames: ['A', 'B', 'C', 'D'] }).preferredNames.length, 3,
    'extra preferences are only an ordering hint and may be trimmed');
});

test('D040: a reply without an assessment is treated as "suggest nothing", not as consent to ask', async () => {
  const { client } = claudeStub(() => parsed({ reflection: 'Rest well.', candidate: { supportMode: 'short_call', availability: null } }));
  const result = await new ClaudeReflectionAdapter({ client }).reflect('SYNTHETIC', 'r');
  assert.equal(result.assessment.intent, 'wants_space');
  assert.match(REFLECTION_SYSTEM_PROMPT, /never infer it from events, excuses, contradictions/i);
  assert.match(REFLECTION_SYSTEM_PROMPT, /can never send anything or choose a person/i);
});

test('D050: a serious-distress risk removes any candidate even if the model also returned one', async () => {
  const { client } = claudeStub(() => parsed({ reflection: 'Support is available now.',
    candidate: { supportMode: 'short_call', availability: 'today' }, assessment: { ...CONNECT, risk: 'urgent_support' } }));
  const result = await new ClaudeReflectionAdapter({ client }).reflect('SYNTHETIC distress', 'r');
  assert.equal(result.candidate, null);
  assert.equal(result.assessment.risk, 'urgent_support');
});
