import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ProviderError } from '@dor/agents';
import { DroidPlanProposer, DroidRunner, MIN_CALL_BUDGET_MS } from '../dist/index.js';

/** SYNTHETIC droid: replies after `delayMs`, or never when delayMs is Infinity. Counts spawns. */
function fakeDroid(delayMs = 0) {
  let spawns = 0;
  const spawn = () => {
    spawns++;
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    if (delayMs !== Infinity) setTimeout(() => {
      child.stderr.end();
      child.stdout.end(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{"decision":"none"}' }));
      child.stdout.on('end', () => child.emit('close', 0));
    }, delayMs);
    return child;
  };
  return { spawn, spawns: () => spawns };
}
const isTimeout = e => e instanceof ProviderError && e.code === 'timeout';

test('deadline: an already-spent job budget fails fast and never spawns droid', async () => {
  const droid = fakeDroid();
  const runner = new DroidRunner({ spawn: droid.spawn, env: {} });
  await assert.rejects(runner.run('p', { deadlineAt: Date.now() - 1 }), isTimeout);
  assert.equal(droid.spawns(), 0);
  await runner.close();
});

test('deadline: the per-call timeout is clipped to what is left of the job budget', async () => {
  const droid = fakeDroid(Infinity);
  const runner = new DroidRunner({ spawn: droid.spawn, env: {}, timeoutMs: 10_000 });
  const started = Date.now();
  await assert.rejects(runner.run('p', { deadlineAt: Date.now() + 400 }), isTimeout);
  assert.equal(droid.spawns(), 1);
  assert.ok(Date.now() - started < 2000, 'stopped at the job deadline, not the 10 s call timeout');
  await runner.close();
});

test('deadline: a queued call leaves the queue at its deadline and the slot goes to the next live waiter', async () => {
  const droid = fakeDroid(60);
  const runner = new DroidRunner({ spawn: droid.spawn, env: {}, concurrency: 1 });
  const first = runner.run('first');
  const expired = runner.run('expired', { deadlineAt: Date.now() + 10 });
  const patient = runner.run('patient');
  await assert.rejects(expired, isTimeout);
  assert.deepEqual(await first, { decision: 'none' });
  assert.deepEqual(await patient, { decision: 'none' });
  assert.equal(droid.spawns(), 2, 'the expired call never ran');
  await runner.close();
});

test('deadline: proposers carry one job deadline across their rounds', async () => {
  const droid = fakeDroid(Infinity);
  const runner = new DroidRunner({ spawn: droid.spawn, env: {}, timeoutMs: 10_000 });
  const proposer = new DroidPlanProposer({ runner, deadlineAt: Date.now() + 400 });
  const input = { events: [{ topics: ['hiking'], format: 'in_person', startsInHours: 30 }], round: 1 };
  await assert.rejects(proposer.propose(input, 'r'), isTimeout);
  await assert.rejects(proposer.propose({ ...input, round: 2 }, 'r'), isTimeout);
  assert.equal(droid.spawns(), 1, 'round 2 after the deadline does not spawn');
  await runner.close();
});

test('deadline: a sliver of budget (timers can fire ~1 ms early) never starts a call it would have to kill', async () => {
  const droid = fakeDroid();
  const runner = new DroidRunner({ spawn: droid.spawn, env: {} });
  await assert.rejects(runner.run('p', { deadlineAt: Date.now() + MIN_CALL_BUDGET_MS - 50 }), isTimeout);
  assert.equal(droid.spawns(), 0);
  await runner.close();
});
