import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { InFlightRequests, ProviderError, RateLimiter, handleReflectionRequest, handleVoiceSessionRequest } from '../dist/index.js';
import { RouteError, createReflectionClient, createVoiceSessionClient } from '../dist/client.js';

const json = async (url) => JSON.parse(await readFile(new URL(url, import.meta.url), 'utf8'));
const reflections = await json('../fixtures/reflection.synthetic.json');
const voice = await json('../fixtures/voice.synthetic.json');
const signedIn = { configured: true, userId: 'user_synthetic' };
const post = (body) => new Request('http://local/api', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body) });
const reflectionStub = (impl) => { const calls = []; return { calls, reflect: async (...a) => { calls.push(a); return impl(...a); } }; };
const okReflection = reflections.cases[0].output;

test('reflection route: auth gate, no anonymous fallback, strict body', async () => {
  const reflection = reflectionStub(() => okReflection);
  const run = (session, body) => handleReflectionRequest(post(body), { session, reflection });
  const valid = { selectedText: 'SYNTHETIC entry', clientRequestId: 'c1' };
  assert.equal((await run({ configured: false, userId: null }, valid)).status, 503);
  assert.equal((await run({ configured: true, userId: null }, valid)).status, 401);
  assert.equal((await run(signedIn, { ...valid, userId: 'spoofed' })).status, 422, 'unknown fields rejected');
  assert.equal((await run(signedIn, { ...valid, selectedText: 'x'.repeat(8001) })).status, 422);
  assert.equal((await run(signedIn, 'not json')).status, 422);
  assert.equal(reflection.calls.length, 0, 'provider never called for rejected requests');
  const ok = await run(signedIn, valid);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await ok.json(), okReflection);
  assert.deepEqual(reflection.calls, [['SYNTHETIC entry', 'c1']]);
});

test('reflection route: provider failures map to API codes without echoing input', async () => {
  const cases = [['refused', 422, 'invalid'], ['rate_limited', 429, 'rate_limited'], ['timeout', 503, 'unavailable'],
    ['not_configured', 503, 'unavailable']];
  for (const [providerCode, status, code] of cases) {
    const reflection = reflectionStub(() => { throw new ProviderError('anthropic', providerCode); });
    const res = await handleReflectionRequest(post({ selectedText: 'SYNTHETIC secret words', clientRequestId: 'c' }),
      { session: signedIn, reflection });
    const text = await res.text();
    assert.equal(res.status, status, providerCode);
    assert.equal(JSON.parse(text).error.code, code);
    assert.equal(text.includes('SYNTHETIC'), false);
  }
  const unknown = reflectionStub(() => { throw new Error('SYNTHETIC internal detail'); });
  const res = await handleReflectionRequest(post({ selectedText: 'x', clientRequestId: 'c' }), { session: signedIn, reflection: unknown });
  assert.equal(res.status, 503);
  assert.equal((await res.text()).includes('SYNTHETIC'), false);
});

test('rate limiter is per user and resets per window', async () => {
  let now = 0;
  const limiter = new RateLimiter({ limit: 2, windowMs: 1000 }, () => now);
  const reflection = reflectionStub(() => okReflection);
  const call = (userId) => handleReflectionRequest(post({ selectedText: 'x', clientRequestId: 'c' }),
    { session: { configured: true, userId }, reflection, limiter });
  assert.deepEqual([(await call('a')).status, (await call('a')).status, (await call('a')).status, (await call('b')).status],
    [200, 200, 429, 200]);
  now = 1000;
  assert.equal((await call('a')).status, 200);
});

test('voice session route: empty body only, returns the scoped session', async () => {
  const voicePort = { createSession: async () => voice.session };
  const run = (body) => handleVoiceSessionRequest(body === undefined ? new Request('http://local', { method: 'POST' }) : post(body),
    { session: signedIn, voice: voicePort });
  assert.equal((await run()).status, 200);
  assert.deepEqual(await (await run({})).json(), voice.session);
  assert.equal((await run({ voiceId: 'x' })).status, 422);
  assert.equal((await handleVoiceSessionRequest(post({}), { session: { configured: true, userId: null }, voice: voicePort })).status, 401);
});

test('browser clients validate responses and surface API error codes', async () => {
  const fakeFetch = (status, body) => async () => new Response(JSON.stringify(body), { status });
  const reflection = createReflectionClient({ fetch: fakeFetch(200, okReflection) });
  assert.deepEqual(await reflection.reflect('SYNTHETIC', 'c'), okReflection);
  await assert.rejects(createReflectionClient({ fetch: fakeFetch(200, { ...okReflection, extra: 1 }) }).reflect('x', 'c'),
    (e) => e instanceof RouteError && e.code === 'invalid_response');
  await assert.rejects(createReflectionClient({ fetch: fakeFetch(401, { error: { code: 'unauthenticated' } }) }).reflect('x', 'c'),
    (e) => e instanceof RouteError && e.status === 401 && e.code === 'unauthenticated');
  assert.deepEqual(await createVoiceSessionClient({ fetch: fakeFetch(200, voice.session) }).createSession(), voice.session);
});

test('reflection route: a double submit joins the running call; nothing is kept after it settles', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const reflection = reflectionStub(async () => { await gate; return okReflection; });
  const inFlight = new InFlightRequests();
  const send = (session, body) => handleReflectionRequest(post(body), { session, reflection, inFlight });
  const body = { selectedText: 'SYNTHETIC entry', clientRequestId: 'c1' };
  const first = send(signedIn, body), second = send(signedIn, body);
  // Same ID, different text, or a different user never joins: each is its own call.
  const otherText = send(signedIn, { ...body, selectedText: 'SYNTHETIC other entry' });
  const otherUser = send({ configured: true, userId: 'user_other' }, body);
  await new Promise(r => setImmediate(r));
  assert.equal(reflection.calls.length, 3);
  release();
  for (const res of await Promise.all([first, second, otherText, otherUser])) assert.equal(res.status, 200);
  assert.equal(inFlight.size, 0, 'no result retained');
  await send(signedIn, body);
  assert.equal(reflection.calls.length, 4, 'a later retry after completion is a new call (no private result cache)');
});

test('reflection route: a failed call is shared by joined duplicates and not remembered', async () => {
  let fail = true;
  const reflection = reflectionStub(async () => {
    await new Promise(r => setImmediate(r));
    if (fail) throw new ProviderError('anthropic', 'timeout');
    return okReflection;
  });
  const inFlight = new InFlightRequests();
  const send = () => handleReflectionRequest(post({ selectedText: 'SYNTHETIC entry', clientRequestId: 'c1' }),
    { session: signedIn, reflection, inFlight });
  const statuses = (await Promise.all([send(), send()])).map(r => r.status);
  assert.deepEqual(statuses, [503, 503]);
  assert.equal(reflection.calls.length, 1);
  fail = false;
  assert.equal((await send()).status, 200);
  assert.equal(inFlight.size, 0);
});
