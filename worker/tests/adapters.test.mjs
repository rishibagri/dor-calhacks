import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { ProviderError } from '@dor/agents';
import { DroidAckProposer, SpacetimeCommit, SpacetimeDeliveryState, SpacetimePolicyStateReader, SpacetimeRecipientPreferences,
  SpacetimeSignalSource, WORKER_VIEWS, classifyCommitError, mapRows, spacetimeWorkerPorts, toSignalContext,
  toSupportPreferences } from '../dist/index.js';

const ts = (iso) => ({ microsSinceUnixEpoch: BigInt(Date.parse(iso)) * 1000n });
const ident = (hex) => ({ toHexString: () => hex });
/** SYNTHETIC worker_signal_context row as the generated client delivers it (camelCase, tagged options). */
const camelRow = {
  signalId: 'sig-1', pairId: 'pair-1', senderId: ident('aa'), recipientId: ident('bb'), purpose: 'support_nudge',
  supportMode: { tag: 'some', value: 'short_call' }, availability: { tag: 'none' }, consentVersion: 1,
  recipientPolicyId: 'preset-1', recipientPolicyVersion: 2, presetAssignmentVersion: 3, expiresAt: ts('2099-01-01T00:00:00Z'),
  pairStatus: 'accepted', pairMemberA: ident('aa'), pairMemberB: ident('bb'), assignmentRecipient: ident('bb'),
  assignmentPresetId: 'preset-1', assignmentVersion: 3, presetAllowedCategories: ['support_preference'],
  presetVersion: 2n, presetExpiresAt: ts('2099-01-01T00:00:00Z'), presetRevoked: false,
};
const source = (rows, delivery = []) => ({ signalContext: async () => rows, delivery: async () => delivery,
  commitNudge: async () => {} });

test('rows: camelCase bindings, tagged options, bigint versions map to the policy shapes', async () => {
  const loaded = await new SpacetimePolicyStateReader(source([camelRow])).load('sig-1');
  assert.equal(loaded.signal.supportMode, 'short_call');
  assert.equal(loaded.signal.availability, undefined);
  assert.equal(loaded.signal.revokedAtMs, null);
  assert.deepEqual(loaded.snapshot.pair, { pairId: 'pair-1', memberA: 'aa', memberB: 'bb', status: 'accepted' });
  assert.equal(loaded.snapshot.preset.version, 2);
  assert.equal(loaded.snapshot.assignment.recipientId, 'bb');
  const [signal] = await new SpacetimeSignalSource(source([camelRow])).approvedSignals('pair-1', ['sig-1']);
  assert.equal(signal.schemaVersion, 2);
  assert.equal(signal.expiresAt, '2099-01-01T00:00:00.000Z');
  assert.equal('availability' in signal, false);
});

test('rows: a revoked preset flag denies; a missing preset leaves assignment and preset null', () => {
  assert.notEqual(toSignalContext({ ...camelRow, presetRevoked: true }).snapshot.preset.revokedAtMs, null);
  const bare = toSignalContext({ ...camelRow, assignmentPresetId: undefined, presetVersion: undefined, presetExpiresAt: undefined });
  assert.equal(bare.snapshot.preset, null);
  assert.equal(bare.snapshot.assignment, null);
});

test('rows: schema drift drops the row (fail closed) instead of guessing', async () => {
  const drifted = { ...camelRow, consentVersion: 'one' };
  assert.deepEqual(mapRows([drifted, null, 7], toSignalContext), []);
  assert.equal(await new SpacetimePolicyStateReader(source([drifted])).load('sig-1'), null);
  assert.deepEqual(await new SpacetimeSignalSource(source([camelRow])).approvedSignals('other-pair', ['sig-1']), []);
});

test('delivery: no row means not opted in; a row maps quiet hours and last nudge', async () => {
  const port = new SpacetimeDeliveryState(source([], [{ pair_id: 'pair-1', recipient: ident('bb'), opted_in: true,
    quiet_start_minute: 1320, quiet_end_minute: undefined, utc_offset_minutes: -420, last_nudge_at: ts('2026-10-24T00:00:00Z') }]));
  assert.equal((await port.current('pair-1', 'cc')).delivery.optedIn, false);
  const row = await port.current('pair-1', 'bb');
  assert.deepEqual(row.delivery, { optedIn: true, quietStartMinute: 1320, quietEndMinute: null, utcOffsetMinutes: -420 });
  assert.equal(row.lastNudgeAt.toISOString(), '2026-10-24T00:00:00.000Z');
});

// ---- D035 recipient preference consent ----
/** SYNTHETIC worker_support_preferences row (camelCase bindings). */
const prefRow = { consentId: 'consent-1', pairId: 'pair-1', recipient: ident('bb'), supportModes: ['short_call'],
  availability: ['today'], consentVersion: 2n, expiresAt: ts('2099-01-01T00:00:00Z') };

test('preferences: view row maps to RecipientSupportPreferences; wrong pair/recipient or drift means none', async () => {
  const p = toSupportPreferences(prefRow);
  assert.deepEqual(p, { schemaVersion: 1, consentId: 'consent-1', consentVersion: 2, pairId: 'pair-1', recipientId: 'bb',
    purpose: 'support_nudge', supportModes: ['short_call'], availability: ['today'], expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null });
  const reader = new SpacetimeRecipientPreferences({ ...source([]), supportPreferences: async () => [prefRow, { ...prefRow, supportModes: 'x' }] });
  assert.equal((await reader.current('pair-1', 'bb')).consentId, 'consent-1');
  assert.equal(await reader.current('pair-1', 'cc'), null);
  assert.equal(await reader.current('pair-2', 'bb'), null);
});

test('preferences: a source without the view (older adapter) has no consent: fail closed; ports default to the view', async () => {
  assert.equal(await new SpacetimeRecipientPreferences(source([])).current('pair-1', 'bb'), null);
  assert.ok(spacetimeWorkerPorts(source([])).preferences instanceof SpacetimeRecipientPreferences);
  assert.ok(WORKER_VIEWS.includes('worker_support_preferences'));
});

test('commit: binds the compatible ACK consent; a nudge without one is refused locally and never sent', async () => {
  const calls = [];
  const commit = new SpacetimeCommit({ ...source([]), commitNudge: async a => { calls.push(a); } });
  const nudge = { id: 'n1', pairId: 'pair-1', templateId: 'offer_short_call', sourceSignalIds: ['sig-1'], sourceConsentVersions: [1] };
  const ack = { schemaVersion: 1, signalId: 'sig-1', recipientConsentId: 'consent-1', recipientConsentVersion: 2, decision: 'compatible' };
  assert.deepEqual(await commit.commit({ acknowledgements: [ack], proposedNudges: [nudge], outcomes: [] }), []);
  assert.equal(calls[0].recipient_consent_id, 'consent-1');
  assert.equal(calls[0].recipient_consent_version, 2);
  const none = await commit.commit({ acknowledgements: [{ ...ack, decision: 'decline' }], proposedNudges: [nudge], outcomes: [] });
  assert.deepEqual(none, [{ nudgeId: 'n1', outcome: 'policy_denied' }]);
  assert.equal(calls.length, 1);
});

test('commit errors: guard refusals are recorded; deployment and transport faults are retried', () => {
  assert.equal(classifyCommitError(new Error('stale: revoked')), 'policy_denied');
  assert.equal(classifyCommitError(new Error('rate_limited: quiet_hours')), 'quiet_hours');
  assert.equal(classifyCommitError(new Error('unauthorized: not_opted_in')), 'not_opted_in');
  assert.equal(classifyCommitError(new Error('unauthorized: worker only')), null);
  assert.equal(classifyCommitError(new Error('socket hang up')), null);
  assert.equal(classifyCommitError(new Error('unavailable: bindings lack commit_nudge')), null);
});

/** Fake droid whose runs stay open until released, to observe overlap. */
function heldSpawn() {
  const runs = [];
  const spawn = (_cmd, _args, options) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    const run = { cwd: options.cwd, existed: existsSync(options.cwd), release: () => {
      child.stderr.end();
      child.stdout.end(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{"decision":"decline"}' }));
      child.stdout.on('end', () => child.emit('close', 0));
    } };
    runs.push(run);
    return child;
  };
  return { runs, spawn };
}
const input = { approved: { supportMode: 'short_call' }, options: [{ supportMode: 'short_call' }], round: 1 };
/** Waits (bounded) for slot directories to be created and runs to start. */
async function until(condition) {
  for (const end = Date.now() + 2000; !condition() && Date.now() < end;) await new Promise(r => setTimeout(r, 5));
}

test('droid slots: concurrent runs never share a directory; extra calls queue, overflow fails fast', async () => {
  const { runs, spawn } = heldSpawn();
  const proposer = new DroidAckProposer({ spawn, env: {}, concurrency: 2, maxQueue: 1, timeoutMs: 5000 });
  const a = proposer.propose(input, 'r1');
  const b = proposer.propose(input, 'r2');
  const c = proposer.propose(input, 'r3');
  await assert.rejects(proposer.propose(input, 'r4'), e => e instanceof ProviderError && e.code === 'rate_limited');
  await until(() => runs.length >= 2);
  assert.equal(runs.length, 2, 'only two run at once');
  assert.notEqual(runs[0].cwd, runs[1].cwd, 'each run has its own directory');
  runs[0].release(); // whichever call it belongs to: slot directories are created concurrently
  assert.deepEqual(await Promise.race([a, b]), { decision: 'decline' });
  await until(() => runs.length >= 3);
  assert.equal(runs.length, 3, 'the queued call takes the freed slot');
  assert.equal(runs[2].cwd, runs[0].cwd, 'and reuses that slot directory (prompt cache)');
  runs[1].release(); runs[2].release();
  await Promise.all([b, c]);
  await proposer.close();
  assert.equal(existsSync(runs[0].cwd) || existsSync(runs[1].cwd), false, 'close removes every slot directory');
});

test('intro prompt: published overlap tags and event counts only; ack and intro agents share one slot pool', async () => {
  const { buildIntroPrompt, DroidIntroProposer, DroidAckProposer: Ack, DroidRunner } = await import('../dist/index.js');
  const prompt = buildIntroPrompt({ candidates: [{ reasons: ['shared_interest'], sharedTags: ['board-games'], sharedEvent: false },
    { reasons: ['same_event'], sharedTags: ['hiking'], sharedEvent: true }], round: 2 });
  assert.match(prompt, /previous reply could not be used/);
  assert.match(prompt, /0: reasons \["shared_interest"\]; shared interests \["board-games"\]; no shared event/);
  assert.match(prompt, /1: reasons \["same_event"\]; shared interests \["hiking"\]; both plan to attend the same event/);
  assert.match(prompt, /"decision":"none"/);
  const { runs, spawn } = heldSpawn();
  const runner = new DroidRunner({ spawn, env: {}, concurrency: 1, timeoutMs: 5000 });
  const intro = new DroidIntroProposer({ runner });
  const ack = new Ack({ runner });
  const first = intro.propose({ candidates: [{ reasons: ['shared_interest'], sharedTags: ['hiking'], sharedEvent: false }], round: 1 }, 'r1');
  const second = ack.propose(input, 'r2');
  await until(() => runs.length >= 1);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(runs.length, 1, 'one shared slot: the ack call waits for the intro call');
  runs[0].release();
  await first;
  await until(() => runs.length >= 2);
  runs[1].release();
  await second;
  await runner.close();
});

test('plan prompt: topics, format and lead time only', async () => {
  const { buildPlanPrompt } = await import('../dist/index.js');
  const prompt = buildPlanPrompt({ events: [{ topics: ['board-games'], format: 'in_person', startsInHours: 30 },
    { topics: ['film'], format: 'online', startsInHours: 6 }], round: 1 });
  assert.match(prompt, /0: topics \["board-games"\]; in person; starts in about 30 hours/);
  assert.match(prompt, /1: topics \["film"\]; online; starts in about 6 hours/);
  assert.doesNotMatch(prompt, /previous reply/);
});
