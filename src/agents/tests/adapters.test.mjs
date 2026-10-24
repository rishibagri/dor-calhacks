import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { PrivateReflectionSchema, VoiceSessionSchema } from '@dor/contracts';
import { CartesiaVoiceAdapter, ClaudeReflectionAdapter, ProviderError, sniffAudioExtension } from '../dist/index.js';

const json = async (url) => JSON.parse(await readFile(new URL(url, import.meta.url), 'utf8'));
const reflections = await json('../fixtures/reflection.synthetic.json');
const voice = await json('../fixtures/voice.synthetic.json');
const code = (c) => (e) => e instanceof ProviderError && e.code === c;

function claudeStub(respond) {
  const calls = [];
  return { calls, client: { beta: { messages: { parse: async (params) => { calls.push(params); return respond(params); } } } } };
}
const parsed = (parsed_output, stop_reason = 'end_turn') => ({ stop_reason, parsed_output, content: [] });

test('reflection fixtures satisfy the C1 contract and their own expectations', () => {
  for (const c of reflections.cases) {
    const output = PrivateReflectionSchema.parse(c.output);
    if ('candidate' in c.expect) assert.deepEqual(output.candidate, c.expect.candidate, c.id);
    if (c.expect.reflectionMentionsCrisisSupport) assert.match(output.reflection, /988|emergency|crisis/i);
  }
});

test('Claude reflection: request shape carries the selected text only, with fallback and low effort', async () => {
  const { calls, client } = claudeStub(() => parsed({ reflection: ' A synthetic reflection. ',
    candidate: { supportMode: 'short_call', availability: null } }));
  const result = await new ClaudeReflectionAdapter({ client }).reflect('  SYNTHETIC entry  ', 'req-1');
  assert.deepEqual(result, { schemaVersion: 1, reflection: 'A synthetic reflection.', candidate: { supportMode: 'short_call' } });
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
