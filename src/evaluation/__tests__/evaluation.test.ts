// DS 30-case evaluation (offline). Runs under `npm run test:app`.
// Policy decisions come from the C6 fake (test-only): passing is not security or live evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AgentAckSchema, ApprovedSignalSchema, RecipientPresetAssignmentSchema, RelationshipPresetSchema } from '@dor/contracts';
import { buildNudge, buildPreview, intersectAvailability, matchSignal } from '../matching.ts';
import { SUPPORT_GROUPS as GROUPS, crossedTerms, runSupportCase } from '../support-pipeline.ts';

const data = JSON.parse(await readFile(new URL('../fixtures/evaluation-cases.json', import.meta.url), 'utf8'));
const now = new Date(data.clock);

const runCase = (c: any) => runSupportCase(data, c);
const leaks = crossedTerms;

test('set composition: 30 synthetic cases, 6 per group, unique IDs, one seed per relationship', () => {
  assert.equal(data.synthetic, true);
  assert.equal(data.cases.length, 30);
  for (const g of GROUPS) assert.equal(data.cases.filter((c: any) => c.group === g).length, 6, g);
  assert.equal(new Set(data.cases.map((c: any) => c.id)).size, 30);
  const seeds = data.cases.filter((c: any) => c.seed);
  assert.deepEqual(seeds.map((c: any) => c.relationship).sort(), ['family', 'friends', 'partners']);
  for (const c of data.cases) {
    assert.match(c.privateContext, /^SYNTHETIC: /, c.id);
    assert.ok(c.forbiddenDisclosures.length > 0, c.id);
  }
});

for (const c of data.cases) {
  test(`case ${c.id} [${c.group}]`, { todo: c.knownGap }, async () => {
    const r = await runCase(c);
    assert.deepEqual(r.preview, c.expected.preview, 'preview');
    assert.equal(r.policy?.reason ?? null, c.expected.policyReason, 'policy reason');
    assert.deepEqual(r.match, c.expected.match, 'match');
    assert.deepEqual(leaks(r.crossed, c.forbiddenDisclosures), [], 'forbidden disclosure crossed the boundary');
    if (!c.bypassesPreview && c.submittedSignal !== null && r.preview.kind === 'preview') {
      const { supportMode, availability } = c.submittedSignal;
      assert.deepEqual(JSON.parse(JSON.stringify({ supportMode, availability })), r.preview.fields,
        'submitted envelope must be exactly the previewed fields');
    }
  });
}

test('release bar: every revoked, expired and unlinked case is suppressed', async () => {
  const lifecycle = data.cases.filter((c: any) => ['revoked', 'expired', 'unlinked'].includes(c.expected.policyReason));
  assert.ok(lifecycle.length >= 3);
  for (const c of lifecycle) assert.equal((await runCase(c)).match.outcome, 'no_nudge', c.id);
});

test('release bar: no attack or no-action case produces a nudge (known gaps excluded and reported)', async () => {
  const gaps = data.cases.filter((c: any) => c.knownGap).map((c: any) => c.id);
  assert.deepEqual(gaps, ['a3-attack-semantic-signal-id']);
  for (const c of data.cases.filter((c: any) => ['privacy_attack', 'no_action'].includes(c.group) && !c.knownGap))
    assert.equal((await runCase(c)).match.outcome, 'no_nudge', c.id);
});

test('quiz draft categories are not read by any stage', async () => {
  for (const c of data.cases.filter((c: any) => c.expected.policyReason !== null)) {
    const before = await runCase(c);
    for (const drafts of [[], ['support_preference'], ['coarse_availability'], ['support_preference', 'coarse_availability']]) {
      const after = await runCase({ ...c, ownerLocal: { ...c.ownerLocal, draftSharingCategories: drafts } });
      assert.deepEqual([after.preview, after.policy, after.match], [before.preview, before.policy, before.match], c.id);
    }
  }
});

test('availability intersection is narrowest common window and never invents one', () => {
  assert.equal(intersectAvailability('today', 'this_week'), 'today');
  assert.equal(intersectAvailability('this_week', 'today'), 'today');
  assert.equal(intersectAvailability('no_preference', 'this_week'), 'this_week');
  assert.equal(intersectAvailability('this_week', 'no_preference'), 'this_week');
  assert.equal(intersectAvailability('no_preference', 'no_preference'), 'no_preference');
  assert.equal(intersectAvailability(undefined, 'today'), undefined);
  assert.equal(intersectAvailability('today', undefined), undefined);
});

test('matchSignal re-parses the envelope even when the policy says ok', () => {
  const r = matchSignal({ signal: { schemaVersion: 2, reason: 'x' }, policy: { allowed: true, reason: 'ok' }, ack: null,
    now, inQuietHours: false, lastNudgeAt: null });
  assert.deepEqual(r, { outcome: 'no_nudge', reason: 'invalid_schema' });
});

test('nudge expiry is capped at 24h and at the signal expiry', async () => {
  const seed = data.cases.find((c: any) => c.id === 'p1-partners-call-this-week');
  const signal = ApprovedSignalSchema.parse(seed.submittedSignal);
  const ack = AgentAckSchema.parse(seed.ack);
  const match = (await runCase(seed)).match;
  assert.equal(match.outcome, 'nudge');
  if (match.outcome !== 'nudge') return;
  assert.equal(buildNudge(signal, ack, match, { id: 'n', now }).expiresAt, '2026-10-25T00:00:00.000Z');
  const early = { ...signal, expiresAt: '2026-10-24T06:00:00Z' };
  assert.equal(buildNudge(early, ack, match, { id: 'n', now }).expiresAt, '2026-10-24T06:00:00.000Z');
});

// f4 relabel (core3-audit.md item 3, CS 427cd3f): quiz "space" is neither a standing suppressor nor an authorization.
const f4 = data.cases.find((c: any) => c.id === 'f4-friends-owner-prefers-space');

test('quiz space: a later eligible candidate reaches an owner-only preview, and nothing is sent', async () => {
  assert.equal(f4.ownerLocal.prefersSpace, true);
  const r = await runCase(f4);
  assert.deepEqual(r.preview, { kind: 'preview', fields: { supportMode: 'encouraging_note' } });
  // Owner-only: without the owner's approval there is no envelope, no policy check and no nudge.
  assert.equal(r.policy, null);
  assert.deepEqual(r.match, { outcome: 'no_nudge', reason: 'no_signal' });
  assert.deepEqual(r.crossed, [r.preview]);
});

test('quiz space alone never authorizes a nudge', async () => {
  // No candidate: the quiz answer contributes nothing to a preview.
  assert.deepEqual((await runCase({ ...f4, candidate: null })).preview, { kind: 'no_signal', reason: 'no_candidate' });
  // An envelope built from the preview but never approved is denied, so quiz space cannot stand in for approval.
  const unapproved = { schemaVersion: 2, signalId: 'sig-f4', pairId: 'friends-pair', senderId: 'friends-a',
    recipientId: 'friends-b', purpose: 'support_nudge', supportMode: 'encouraging_note', consentVersion: 1,
    recipientPolicyId: 'friends-policy', recipientPolicyVersion: 1, presetAssignmentVersion: 1, expiresAt: '2026-10-25T00:00:00Z' };
  const ack = { schemaVersion: 1, signalId: 'sig-f4', recipientConsentId: 'consent-f4', recipientConsentVersion: 1,
    decision: 'compatible', supportMode: 'encouraging_note' };
  const r = await runCase({ ...f4, submittedSignal: unapproved, approvedSignal: null, ack });
  assert.equal(r.policy?.reason, 'no_consent');
  assert.equal(r.match.outcome, 'no_nudge');
  // Approved but no recipient consent on the ACK: still no nudge.
  const noAck = await runCase({ ...f4, submittedSignal: unapproved, approvedSignal: unapproved, ack: null });
  assert.equal(noAck.match.outcome, 'no_nudge');
});

test('quiz space is not a buildPreview input: an extra prefersSpace field changes nothing', () => {
  const input = { candidate: f4.candidate, preset: RelationshipPresetSchema.parse(f4.preset),
    assignment: RecipientPresetAssignmentSchema.parse(f4.assignment), recipientId: f4.deliverTo };
  for (const prefersSpace of [true, false])
    assert.deepEqual(buildPreview({ ...input, prefersSpace } as typeof input), buildPreview(input));
});
