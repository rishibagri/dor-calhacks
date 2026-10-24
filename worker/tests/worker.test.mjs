import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { ProviderError } from '@kinetic/agents';
import { DroidAckProposer, buildAckPrompt, createJobRequestHandler, extractJsonObject } from '../dist/index.js';

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
    calls.push({ command, args, options, child, sandboxExisted: existsSync(options.cwd) });
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

test('droid runs with a one-tool allowlist, read-only autonomy and an empty sandbox that is removed', async () => {
  const { calls, spawn } = fakeSpawn({ stdout: envelope('{"decision":"compatible","optionIndex":0}') });
  const result = await new DroidAckProposer({ spawn, env: {} }).propose(input, 'req');
  assert.deepEqual(result, { decision: 'compatible', optionIndex: 0 });
  const [{ command, args, options, sandboxExisted }] = calls;
  assert.equal(command, 'droid');
  assert.deepEqual(args.slice(0, 5), ['exec', '--output-format', 'json', '--only-tools', 'TodoWrite']);
  assert.ok(args.includes('--disable-builtin-skills'));
  assert.equal(args.some(a => a === '--auto' || a.startsWith('--skip-permissions')), false);
  assert.equal(args[args.indexOf('--cwd') + 1], options.cwd);
  assert.ok(sandboxExisted, 'sandbox exists during the run');
  assert.equal(existsSync(options.cwd), false, 'sandbox is removed afterwards');
});

test('droid subprocess inherits no Claude, Cartesia or worker secrets', async () => {
  const { calls, spawn } = fakeSpawn({ stdout: envelope('{"decision":"decline"}') });
  const env = { PATH: '/usr/bin', HOME: '/home/synthetic', FACTORY_API_KEY: 'fk-synthetic', ANTHROPIC_API_KEY: 'sk-ant-synthetic',
    CARTESIA_API_KEY: 'sk_car_synthetic', KINETIC_WORKER_AUTH_TOKEN: 'synthetic-worker-token', CLERK_SECRET_KEY: 'synthetic' };
  await new DroidAckProposer({ spawn, env }).propose(input, 'req');
  assert.deepEqual(calls[0].options.env, { PATH: '/usr/bin', HOME: '/home/synthetic', FACTORY_API_KEY: 'fk-synthetic' });
});

test('droid prompt contains approved enums and options only', () => {
  const prompt = buildAckPrompt(input);
  assert.match(prompt, /"supportMode":"short_call"/);
  assert.match(prompt, /0: \{"supportMode":"short_call","availability":"this_week"\}/);
  assert.equal(/signal|pair|consent|journal/i.test(prompt.replace(/approved|Kinetic/g, '')), false);
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
