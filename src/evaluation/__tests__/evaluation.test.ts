// DS 30-case evaluation (offline). Runs under `npm run test:app`.
// Policy decisions come from the C6 fake (test-only): passing is not security or live evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AgentAckSchema, ApprovedSignalSchema, RecipientPresetAssignmentSchema, RelationshipPresetSchema } from '@dor/contracts';
import type { PolicyResult } from '@dor/contracts';
import { FakeClock, FakeDisclosurePolicy } from '@dor/contracts/fakes';
import { buildNudge, buildPreview, intersectAvailability, matchSignal, type MatchResult, type PreviewResult } from '../matching.ts';

const data = JSON.parse(await readFile(new URL('../fixtures/evaluation-cases.json', import.meta.url), 'utf8'));
const now = new Date(data.clock);
const GROUPS = ['partners', 'friends', 'family', 'privacy_attack', 'no_action'];

function leaks(payloads: unknown[], terms: string[]): string[] {
  const wire = JSON.stringify(payloads).toLowerCase();
  return terms.filter(t => wire.includes(t.toLowerCase()));
}

async function runCase(c: any): Promise<{ preview: PreviewResult; policy: PolicyResult | null; match: MatchResult; crossed: unknown[] }> {
  const preset = RelationshipPresetSchema.parse(c.preset);
  const assignment = RecipientPresetAssignmentSchema.parse(c.assignment);
  const preview = buildPreview({ candidate: c.candidate, preset, assignment, recipientId: c.deliverTo,
    prefersSpace: c.ownerLocal.prefersSpace });
  const policy = c.submittedSignal === null ? null : await new FakeDisclosurePolicy({
    clock: new FakeClock(data.clock), linked: c.state.linked, revoked: c.state.revoked, preset, assignment,
    approved: c.approvedSignal,
  }).check(c.submittedSignal, c.deliverTo);
  const match = matchSignal({ signal: c.submittedSignal, policy, ack: c.ack, now,
    inQuietHours: c.delivery.inQuietHours, lastNudgeAt: c.delivery.lastNudgeAt });
  // What reaches the recipient side: the preview shown to the owner always; envelope and ACK only when allowed.
  const crossed: unknown[] = [preview];
  if (policy?.allowed) crossed.push(c.submittedSignal, c.ack);
  if (match.outcome === 'nudge') {
    crossed.push(buildNudge(ApprovedSignalSchema.parse(c.submittedSignal), AgentAckSchema.parse(c.ack), match,
      { id: `nudge-${GROUPS.indexOf(c.group)}-${data.cases.indexOf(c)}`, now }));
  }
  return { preview, policy, match, crossed };
}

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
