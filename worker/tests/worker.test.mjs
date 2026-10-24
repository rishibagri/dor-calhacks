import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { ProviderError } from '@dor/agents';
import { DroidAckProposer, JobConflictError, JobLedger, buildAckPrompt, createJobRequestHandler, createLiveWorker,
  extractJsonObject, runCoordinationJob } from '../dist/index.js';

const input = { approved: { supportMode: 'short_call', availability: 'this_week' },
  options: [{ supportMode: 'short_call', availability: 'this_week' }], round: 1 };
const code = (c) => (e) => e instanceof ProviderError && e.code === c;

/** Fake child process: records spawn arguments and replays stdout/exit. */
function fakeSpawn({ stdout = '', exitCode = 0, error, hang = false } = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.killed = [];
    child.kill = (signal) => { child.killed.push(signal); queueMicrotask(() => child.emit('close', null)); };
    calls.push({ command, args, options, child, sandboxExisted: existsSync(options.cwd),
      leftovers: existsSync(options.cwd) ? readdirSync(options.cwd) : null });
    queueMicrotask(() => {
      if (error) return child.emit('error', error);
      if (hang) return;
      child.stderr.end('SYNTHETIC stderr that must never be logged');
      child.stdout.end(stdout);
      child.stdout.on('end', () => child.emit('close', exitCode));
    });
    return child;
  };
  return { calls, spawn };
}
const envelope = (result, extra = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false,
  duration_ms: 1, num_turns: 1, result, session_id: 'synthetic', ...extra });

test('droid runs with a one-tool allowlist, read-only autonomy and a reused, emptied private workdir', async () => {
  const { calls, spawn } = fakeSpawn({ stdout: envelope('{"decision":"compatible","optionIndex":0}') });
  const proposer = new DroidAckProposer({ spawn, env: {} });
  assert.deepEqual(await proposer.propose(input, 'req'), { decision: 'compatible', optionIndex: 0 });
  const [{ command, args, options, sandboxExisted }] = calls;
  assert.equal(command, 'droid');
  assert.deepEqual(args.slice(0, 5), ['exec', '--output-format', 'json', '--only-tools', 'TodoWrite']);
  assert.ok(args.includes('--disable-builtin-skills'));
  assert.equal(args[args.indexOf('--model') + 1], 'claude-haiku-5-5');
  assert.equal(args.some(a => a === '--auto' || a.startsWith('--skip-permissions')), false);
  assert.equal(args[args.indexOf('--cwd') + 1], options.cwd);
  assert.ok(sandboxExisted, 'workdir exists during the run');
  // Something left behind is cleared before the next call; the path stays stable for prompt caching.
  writeFileSync(join(options.cwd, 'stray.txt'), 'synthetic');
  await proposer.propose(input, 'req-2');
  assert.equal(calls[1].options.cwd, options.cwd);
  assert.deepEqual(calls[1].leftovers, []);
  await proposer.close();
  assert.equal(existsSync(options.cwd), false, 'workdir is removed on close');
});

test('droid usage is reported as numbers only', async () => {
  const usage = [];
  const { spawn } = fakeSpawn({ stdout: envelope('{"decision":"decline"}', { usage: { input_tokens: 4, output_tokens: 20,
    cache_read_input_tokens: 2253, cache_creation_input_tokens: 0, factory_credits: 14, ttft_ms: 1468 } }) });
  const proposer = new DroidAckProposer({ spawn, env: {}, model: 'claude-opus-5-5', onUsage: (u) => usage.push(u) });
  await proposer.propose(input, 'req');
  await proposer.close();
  assert.equal(usage.length, 1);
  const { durationMs, ...rest } = usage[0];
  assert.equal(typeof durationMs, 'number');
  assert.deepEqual(rest, { model: 'claude-opus-5-5', factoryCredits: 14, cacheReadTokens: 2253, cacheCreationTokens: 0 });
});

test('droid subprocess inherits no Claude, Cartesia or worker secrets', async () => {
  const { calls, spawn } = fakeSpawn({ stdout: envelope('{"decision":"decline"}') });
  const env = { PATH: '/usr/bin', HOME: '/home/synthetic', FACTORY_API_KEY: 'fk-synthetic', ANTHROPIC_API_KEY: 'sk-ant-synthetic',
    CARTESIA_API_KEY: 'sk_car_synthetic', DOR_WORKER_AUTH_TOKEN: 'synthetic-worker-token', CLERK_SECRET_KEY: 'synthetic' };
  await new DroidAckProposer({ spawn, env }).propose(input, 'req');
  assert.deepEqual(calls[0].options.env, { PATH: '/usr/bin', HOME: '/home/synthetic', FACTORY_API_KEY: 'fk-synthetic' });
});

test('droid prompt contains approved enums and options only', () => {
  const prompt = buildAckPrompt(input);
  assert.match(prompt, /"supportMode":"short_call"/);
  assert.match(prompt, /0: \{"supportMode":"short_call","availability":"this_week"\}/);
  assert.equal(/signal|pair|consent|journal/i.test(prompt.replace(/approved|dor/g, '')), false);
  assert.match(buildAckPrompt({ ...input, round: 2 }), /previous reply could not be used/);
});

test('droid failures map to sanitized provider errors', async () => {
  const run = (opts) => new DroidAckProposer({ spawn: fakeSpawn(opts).spawn, env: {}, timeoutMs: 50 }).propose(input, 'r');
  await assert.rejects(run({ stdout: envelope('x', { is_error: true, subtype: 'error_during_execution' }) }), code('unavailable'));
  await assert.rejects(run({ stdout: 'not json' }), code('invalid_output'));
  await assert.rejects(run({ stdout: '', exitCode: 1 }), code('unavailable'));
  await assert.rejects(run({ error: Object.assign(new Error('spawn droid ENOENT'), { code: 'ENOENT' }) }), code('not_configured'));
  const hanging = fakeSpawn({ hang: true });
  await assert.rejects(new DroidAckProposer({ spawn: hanging.spawn, env: {}, timeoutMs: 20 }).propose(input, 'r'), code('timeout'));
  assert.deepEqual(hanging.calls[0].child.killed, ['SIGTERM']);
});

test('model text around the JSON object is tolerated; non-JSON passes through for the coordinator to reject', () => {
  assert.deepEqual(extractJsonObject('```json\n{"decision":"decline"}\n```'), { decision: 'decline' });
  assert.equal(extractJsonObject('I pick option zero'), 'I pick option zero');
});

async function withServer(deps, fn) {
  const server = createServer(createJobRequestHandler(deps));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try { await fn(url); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('job endpoint: bearer auth, strict job schema, content-free outcomes, pair-scoped signals', async () => {
  const scenarios = JSON.parse(await readFile(new URL('../../contracts/fixtures/scenarios.json', import.meta.url), 'utf8'));
  const [partners, friends] = scenarios.map(s => s.approvedSignal);
  const authToken = 'synthetic-worker-token-0123456789abcdef';
  const seen = [], commits = [];
  const deps = {
    authToken,
    signals: { approvedSignals: async () => [partners, friends, { ...partners, signalId: 'unrequested' }] },
    coordinator: { coordinate: async (signals, requestId) => {
      seen.push(signals.map(s => s.signalId));
      return { acknowledgements: [], proposedNudges: [], outcomes: [{ schemaVersion: 1, requestId, pairId: 'partners-pair',
        signalIds: ['partners-signal'], outcome: 'no_intersection', rounds: 0, decidedBy: 'none' }] };
    } },
    commit: { commit: async (result) => { commits.push(result); } },
  };
  const job = { schemaVersion: 1, jobId: 'job-1', pairId: 'partners-pair', requestId: 'req-1',
    signalIds: ['partners-signal'], createdAt: '2026-10-24T00:00:00Z' };
  await withServer(deps, async (url) => {
    const post = (body, token = authToken, path = '/jobs') => fetch(url + path, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    assert.equal((await post(job, 'wrong')).status, 401);
    assert.equal((await post(job, authToken, '/other')).status, 404);
    const invalid = await post({ ...job, transcript: 'SYNTHETIC private text' });
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.text()).includes('SYNTHETIC'), false, 'invalid bodies are not echoed');
    assert.equal((await post('x'.repeat(5000))).status, 413);
    const ok = await post(job);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    assert.equal((await ok.json()).outcomes[0].outcome, 'no_intersection');
  });
  assert.deepEqual(seen, [['partners-signal']], 'only requested signals from the job pair reach the coordinator');
  assert.equal(commits.length, 1);
  assert.throws(() => createJobRequestHandler({ ...deps, authToken: 'short' }));
});

const scenarioSignals = async () => JSON.parse(await readFile(new URL('../../contracts/fixtures/scenarios.json', import.meta.url), 'utf8'))
  .map(s => s.approvedSignal);
const jobFor = (signal, overrides = {}) => ({ schemaVersion: 1, jobId: 'job-1', pairId: signal.pairId, requestId: 'req-1',
  signalIds: [signal.signalId], createdAt: '2026-10-24T00:00:00Z', ...overrides });

test('job ledger: concurrent duplicates and retries coordinate and commit once; conflicts and failures are not reused', async () => {
  const [partners] = await scenarioSignals();
  let coordinations = 0, commits = 0, fail = false;
  const outcome = { schemaVersion: 1, requestId: 'req-1', pairId: partners.pairId, signalIds: [partners.signalId],
    outcome: 'nudge_proposed', rounds: 1, decidedBy: 'agent', nudgeId: 'nudge_x' };
  const deps = {
    ledger: new JobLedger(),
    signals: { approvedSignals: async () => [partners] },
    coordinator: { coordinate: async () => {
      coordinations++;
      await new Promise(r => setTimeout(r, 10));
      if (fail) throw new Error('provider down');
      return { acknowledgements: [], proposedNudges: [], outcomes: [outcome] };
    } },
    commit: { commit: async () => { commits++; } },
  };
  const job = jobFor(partners);
  const [a, b] = await Promise.all([runCoordinationJob(job, deps), runCoordinationJob(job, deps)]);
  assert.deepEqual(a, b);
  assert.deepEqual(await runCoordinationJob({ ...job, createdAt: '2026-10-24T00:05:00Z' }, deps), a, 'retry returns the recorded outcome');
  assert.equal(coordinations, 1);
  assert.equal(commits, 1);
  await assert.rejects(runCoordinationJob({ ...job, requestId: 'req-other' }, deps), JobConflictError);
  fail = true;
  const failing = jobFor(partners, { jobId: 'job-2' });
  await assert.rejects(runCoordinationJob(failing, deps));
  fail = false;
  await runCoordinationJob(failing, deps);
  assert.equal(coordinations, 3, 'a failed job is retried, not replayed');
});

test('job endpoint answers 409 when a job ID is reused with different contents', async () => {
  const [partners] = await scenarioSignals();
  const authToken = 'synthetic-worker-token-0123456789abcdef';
  const deps = { authToken, signals: { approvedSignals: async () => [partners] },
    coordinator: { coordinate: async (signals, requestId) => ({ acknowledgements: [], proposedNudges: [], outcomes: [{
      schemaVersion: 1, requestId, pairId: partners.pairId, signalIds: [partners.signalId], outcome: 'no_intersection',
      rounds: 0, decidedBy: 'none' }] }) },
    commit: { commit: async () => {} } };
  await withServer(deps, async (url) => {
    const post = (body) => fetch(url + '/jobs', { method: 'POST', body: JSON.stringify(body),
      headers: { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' } });
    assert.equal((await post(jobFor(partners))).status, 200);
    assert.equal((await post(jobFor(partners))).status, 200);
    assert.equal((await post(jobFor(partners, { requestId: 'req-2' }))).status, 409);
  });
});

test('live worker uses the real DisclosurePolicy over authoritative state: revoked work never reaches Droid or commit', async () => {
  const [partners] = await scenarioSignals();
  const prefs = JSON.parse(await readFile(new URL('../../src/agents/fixtures/coordination.synthetic.json', import.meta.url), 'utf8'));
  let revokedAtMs = null;
  const stored = () => ({ ...partners, expiresAtMs: Date.parse(partners.expiresAt), revokedAtMs });
  const policyState = { load: async (id) => id !== partners.signalId ? null : { signal: stored(), snapshot: {
    pair: { pairId: partners.pairId, memberA: partners.senderId, memberB: partners.recipientId, status: 'accepted' },
    assignment: { ownerId: partners.senderId, recipientId: partners.recipientId, pairId: partners.pairId,
      presetId: partners.recipientPolicyId, assignmentVersion: partners.presetAssignmentVersion },
    preset: { policyId: partners.recipientPolicyId, ownerId: partners.senderId,
      allowedCategories: ['support_preference', 'coarse_availability'], version: partners.recipientPolicyVersion,
      expiresAtMs: Date.parse(partners.expiresAt), revokedAtMs: null } } } };
  const committed = [];
  const { calls, spawn } = fakeSpawn({ stdout: envelope('{"decision":"compatible","optionIndex":0}') });
  const worker = createLiveWorker({
    authToken: 'synthetic-worker-token-0123456789abcdef', policyState,
    signals: { approvedSignals: async () => [partners] },
    preferences: { current: async () => prefs.preferences.partners },
    delivery: { current: async () => ({ delivery: prefs.defaultDelivery, lastNudgeAt: null }) },
    commit: { commit: async (result) => { committed.push(result); } },
    droid: { spawn, env: {} },
  });
  try {
    const coordinate = (requestId) => worker.coordinator.coordinate([partners], requestId);
    const ok = await coordinate('req-live-ok');
    assert.equal(ok.outcomes[0].outcome, 'nudge_proposed');
    assert.equal(calls.length, 1);
    revokedAtMs = Date.now();
    const denied = await coordinate('req-live-revoked');
    assert.equal(denied.outcomes[0].outcome, 'policy_denied');
    assert.equal(calls.length, 1, 'no Droid call for revoked work');
    const tampered = await worker.coordinator.coordinate([{ ...partners, supportMode: 'shared_activity' }], 'req-tampered');
    assert.equal(tampered.outcomes[0].outcome, 'policy_denied', 'an altered envelope is not the approved payload');
  } finally {
    await worker.close();
  }
});
