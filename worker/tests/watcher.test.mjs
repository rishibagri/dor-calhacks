import test from 'node:test';
import assert from 'node:assert/strict';
import { SignalWatcher } from '../dist/index.js';

const ts = (iso) => ({ microsSinceUnixEpoch: BigInt(Date.parse(iso)) * 1000n });
const ident = (hex) => ({ toHexString: () => hex });
/** SYNTHETIC worker_signal_context row (camelCase, as the generated client delivers it). */
const row = (signalId) => ({
  signalId, pairId: 'pair-1', senderId: ident('aa'), recipientId: ident('bb'), purpose: 'support_nudge',
  supportMode: { tag: 'some', value: 'short_call' }, availability: { tag: 'none' }, consentVersion: 1,
  recipientPolicyId: 'preset-1', recipientPolicyVersion: 1, presetAssignmentVersion: 1, expiresAt: ts('2099-01-01T00:00:00Z'),
  pairStatus: 'accepted', pairMemberA: ident('aa'), pairMemberB: ident('bb'), assignmentRecipient: ident('bb'),
  assignmentPresetId: 'preset-1', assignmentVersion: 1, presetAllowedCategories: ['support_preference'],
  presetVersion: 1, presetExpiresAt: ts('2099-01-01T00:00:00Z'), presetRevoked: false,
});
const source = (rows) => ({ signalContext: async () => rows.current, delivery: async () => [], commitNudge: async () => {} });
const outcome = (job, code) => [{ schemaVersion: 1, requestId: job.requestId, pairId: job.pairId, signalIds: job.signalIds,
  outcome: code, rounds: 0, decidedBy: 'none' }];

test('watcher: a recipient-state deferral is retried on later sweeps until it resolves (no restart needed)', async () => {
  const rows = { current: [row('sig-1')] };
  const jobs = [], reported = [];
  const script = ['not_opted_in', 'not_opted_in', 'preferences_unavailable', 'proposer_failed_fallback'];
  const w = new SignalWatcher(source(rows), { run: async job => { jobs.push(job); return outcome(job, script[jobs.length - 1]); },
    onOutcome: os => reported.push(os[0].outcome) });
  for (let i = 0; i < 6; i++) await w.sweep();
  assert.equal(jobs.length, 4, 'retried while deferred, then never again once a nudge was proposed');
  assert.deepEqual(jobs.map(j => j.requestId), ['sig-1', 'sig-1', 'sig-1', 'sig-1'], 'requestId (so the nudge ID) is stable');
  assert.equal(new Set(jobs.map(j => j.jobId)).size, 4, 'each retry has a fresh jobId so the JobLedger does not replay it');
  assert.equal(jobs[0].jobId, 'job_sig-1', 'first attempt keeps the original jobId');
  assert.deepEqual(reported, ['not_opted_in', 'proposer_failed_fallback'], 'a deferral is reported once, not every sweep');
});

test('watcher: every deferred code retries; terminal outcomes never rerun', async () => {
  for (const code of ['not_opted_in', 'quiet_hours', 'cooldown', 'preferences_unavailable', 'no_intersection']) {
    let runs = 0;
    const w = new SignalWatcher(source({ current: [row('s')] }), { run: async job => { runs++; return outcome(job, code); } });
    await w.sweep(); await w.sweep();
    assert.equal(runs, 2, `${code} is retried`);
  }
  for (const code of ['nudge_proposed', 'proposer_failed_fallback', 'policy_denied', 'recipient_declined', 'proposer_failed_no_suggestion']) {
    let runs = 0;
    const w = new SignalWatcher(source({ current: [row('s')] }), { run: async job => { runs++; return outcome(job, code); } });
    await w.sweep(); await w.sweep(); await w.sweep();
    assert.equal(runs, 1, `${code} is final`);
  }
});

test('watcher: a deferred signal that leaves the view (revoked, expired, paused) is not run again', async () => {
  const rows = { current: [row('sig-1')] };
  let runs = 0;
  const w = new SignalWatcher(source(rows), { run: async job => { runs++; return outcome(job, 'not_opted_in'); } });
  await w.sweep();
  rows.current = [];
  await w.sweep(); await w.sweep();
  assert.equal(runs, 1);
});

test('watcher: thrown job errors still count toward maxAttempts while deferrals do not', async () => {
  let runs = 0;
  const w = new SignalWatcher(source({ current: [row('s')] }), { maxAttempts: 2, run: async () => { runs++; throw new Error('invalid: boom'); },
    onError: () => {} });
  for (let i = 0; i < 5; i++) await w.sweep();
  assert.equal(runs, 2);
});
