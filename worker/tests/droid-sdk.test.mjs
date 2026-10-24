import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderError } from '@dor/agents';
import { DroidRunner, DroidSdkTransport } from '../dist/index.js';

const SYNTHETIC_KEY = 'synthetic-not-a-real-key';
const isCode = c => e => e instanceof ProviderError && e.code === c;

/**
 * SYNTHETIC @factory/droid-sdk createSession: records options, prompts and closes. `tools(n)` gives the n-th
 * session's tool list given its disabledToolIds; `turn(prompt, signal)` yields the stream messages.
 */
function fakeSdk({ tools = () => [{ id: 'TodoWrite', allowed: true }], turn } = {}) {
  const sessions = [];
  const defaultTurn = async function* () {
    yield { type: 'assistant', text: 'thinking' };
    yield { type: 'result', success: true, interrupted: false, text: '{"decision":"none"}',
      tokenUsage: { inputTokens: 900, outputTokens: 12, cacheReadTokens: 800, cacheCreationTokens: 0, factoryCredits: 14 } };
  };
  const createSession = async (options) => {
    const s = { options, prompts: [], closed: false };
    sessions.push(s);
    return {
      listTools: async () => tools(options.disabledToolIds, sessions.length),
      stream: (prompt, o) => { s.prompts.push(prompt); return (turn ?? defaultTurn)(prompt, o?.abortSignal); },
      close: async () => { s.closed = true; },
    };
  };
  return { createSession, sessions };
}
const transport = (sdk, extra = {}) => new DroidSdkTransport({ createSession: sdk.createSession, apiKey: SYNTHETIC_KEY,
  env: { PATH: '/usr/bin' }, ...extra });
const settle = () => new Promise(r => setImmediate(r));

test('sdk: one prompt per session, then closed; the next call uses a warmed spare in the same slot directory', async () => {
  const sdk = fakeSdk();
  const usage = [];
  const runner = new DroidRunner({ transport: transport(sdk), concurrency: 1, onUsage: u => usage.push(u) });
  assert.deepEqual(await runner.run('p1'), { decision: 'none' });
  await settle();
  assert.equal(sdk.sessions.length, 2, 'a spare was warmed after the first call');
  assert.deepEqual(await runner.run('p2'), { decision: 'none' });
  await settle();
  const [a, b] = sdk.sessions;
  assert.deepEqual([a.prompts, b.prompts], [['p1'], ['p2']], 'no session ever answers two prompts');
  assert.ok(a.closed && b.closed);
  assert.equal(a.options.cwd, b.options.cwd, 'stable slot directory keeps the prompt cache warm');
  assert.match(a.options.cwd, /dor-droid-/);
  assert.deepEqual({ ...a.options, cwd: undefined, abortSignal: undefined }, { cwd: undefined, abortSignal: undefined,
    modelId: 'claude-haiku-5-5', reasoningEffort: 'low', autonomyLevel: 'off', autoRejectPermissionRequests: true,
    disableBuiltinSkills: true, disabledToolIds: [], apiKey: SYNTHETIC_KEY, env: { PATH: '/usr/bin' } });
  assert.deepEqual(usage.map(({ durationMs, ...u }) => u)[0],
    { model: 'claude-haiku-5-5', factoryCredits: 14, cacheReadTokens: 800, cacheCreationTokens: 0, outcome: 'ok' });
  await runner.close();
  assert.ok(sdk.sessions.every(s => s.closed), 'close() closes the warmed spare too');
});

test('sdk: concurrent slots get separate sessions and separate directories', async () => {
  const sdk = fakeSdk();
  const runner = new DroidRunner({ transport: transport(sdk), concurrency: 2 });
  await Promise.all([runner.run('a'), runner.run('b')]);
  const used = sdk.sessions.filter(s => s.prompts.length > 0);
  assert.equal(used.length, 2);
  assert.notEqual(used[0].options.cwd, used[1].options.cwd);
  await runner.close();
});

test('sdk tools: an unlisted enabled tool is learned into the deny-list and the session recreated before any prompt', async () => {
  const sdk = fakeSdk({ tools: disabled => [{ id: 'TodoWrite', allowed: true },
    { id: 'Read', allowed: !disabled.includes('Read') }, { id: 'Execute', allowed: !disabled.includes('Execute') }] });
  const t = transport(sdk);
  const runner = new DroidRunner({ transport: t, concurrency: 1 });
  await runner.run('p');
  assert.deepEqual(t.deniedTools, ['Execute', 'Read']);
  assert.deepEqual(sdk.sessions[0].prompts, [], 'the over-privileged session never saw a prompt');
  assert.ok(sdk.sessions[0].closed);
  assert.deepEqual(sdk.sessions[1].options.disabledToolIds, ['Execute', 'Read']);
  await runner.close();
});

test('sdk tools: if disabling does not take effect, fail closed and never send the prompt', async () => {
  const sdk = fakeSdk({ tools: () => [{ id: 'Execute', allowed: true }] });
  const runner = new DroidRunner({ transport: transport(sdk), concurrency: 1 });
  await assert.rejects(runner.run('p'), isCode('not_configured'));
  assert.ok(sdk.sessions.every(s => s.prompts.length === 0 && s.closed));
  await runner.close();
});

test('sdk: any tool call during the turn is invalid output (the agent only picks among options)', async () => {
  const sdk = fakeSdk({ turn: async function* () {
    yield { type: 'tool_call', name: 'TodoWrite' };
    yield { type: 'result', success: true, text: '{"decision":"none"}' };
  } });
  const runner = new DroidRunner({ transport: transport(sdk), concurrency: 1 });
  await assert.rejects(runner.run('p'), isCode('invalid_output'));
  assert.ok(sdk.sessions[0].closed);
  await runner.close();
});

test('sdk: the job deadline aborts a hung turn; that session is closed, never reused', async () => {
  const sdk = fakeSdk({ turn: async function* (_p, signal) {
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  } });
  const runner = new DroidRunner({ transport: transport(sdk), concurrency: 1, timeoutMs: 10_000 });
  const started = Date.now();
  await assert.rejects(runner.run('p', { deadlineAt: Date.now() + 400 }), isCode('timeout'));
  assert.ok(Date.now() - started < 2000);
  assert.ok(sdk.sessions[0].closed);
  await runner.close();
});

test('sdk results: structured output preferred; failed and interrupted turns map to provider codes', async () => {
  const reply = (msg) => fakeSdk({ turn: async function* () { yield { type: 'result', ...msg }; } });
  const run = async (msg) => {
    const runner = new DroidRunner({ transport: transport(reply(msg)), concurrency: 1 });
    try { return await runner.run('p'); } finally { await runner.close(); }
  };
  assert.deepEqual(await run({ success: true, text: 'Sure. {"decision":"decline"}', structuredOutput: { decision: 'none' } }),
    { decision: 'decline' }, 'reply parsed from text, as on the CLI path; an unrequested structuredOutput is ignored');
  await assert.rejects(run({ success: false, interrupted: false }), isCode('unavailable'));
  await assert.rejects(run({ success: false, interrupted: true }), isCode('timeout'));
});

test('sdk: no FACTORY_API_KEY means not_configured (the SDK does not use the CLI login)', () => {
  assert.throws(() => new DroidSdkTransport({ createSession: fakeSdk().createSession, apiKey: undefined }), isCode('not_configured'));
});

test('sdk tools: ToolSearch (not disableable, measured) is tolerated by default; anything else still fails closed', async () => {
  const measured = disabled => [{ id: 'TodoWrite', allowed: true }, { id: 'ToolSearch', allowed: true },
    ...['Execute', 'FetchUrl', 'Read', 'WebSearch'].map(id => ({ id, allowed: !disabled.includes(id) }))];
  const sdk = fakeSdk({ tools: measured });
  const t = transport(sdk);
  const usage = [];
  const runner = new DroidRunner({ transport: t, concurrency: 1, onUsage: u => usage.push(u) });
  assert.deepEqual(await runner.run('p'), { decision: 'none' });
  assert.deepEqual(t.deniedTools, ['Execute', 'FetchUrl', 'Read', 'WebSearch']);
  await runner.close();
  const strict = transport(fakeSdk({ tools: measured }), { allowedTools: ['TodoWrite'] });
  const failing = new DroidRunner({ transport: strict, concurrency: 1, onUsage: u => usage.push(u) });
  await assert.rejects(failing.run('p'), isCode('not_configured'));
  assert.equal(usage.at(-1).outcome, 'not_configured', 'failures are visible in usage, not silent');
  await failing.close();
});
