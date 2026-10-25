// DS consumer evaluation of D044 automatic nudges (docs/features/AUTOMATIC_NUDGES.md, "Consumer checklist → DS"):
// the assessment, quiz or journal can never create a standing rule, and a pause, revoke, replacement or expiry stops
// queued automatic approvals. Offline: only the shared `@dor/contracts` guards and the pure DS/CS models run; the
// reducers, sweep and worker are Cyber's module tests (spacetimedb/tests/standing.test.ts), not exercised here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PrivateAssessmentSchema, PrivateReflectionSchema, SignalCandidateSchema } from '@dor/contracts';
import {
  guardStandingRule, standingRuleStands, STANDING_CONSENT_VERSION, type StandingPresetState, type StandingRuleState,
} from '@dor/contracts/policy';
import { buildProfile, buildQuizExtras, draftCategoriesFor } from '../../components/feature/quiz-model.ts';
import { nudgeAfterApproval, replay, resolveCases, surfacesOf, type DecisionCase } from '../decision-loop.ts';

const json = async (u: string) => JSON.parse(await readFile(new URL(u, import.meta.url), 'utf8'));
const file = resolveCases(await json('../fixtures/decision-cases.json'), await json('../../agents/fixtures/reflection.synthetic.json'));
const profiles = await json('../fixtures/quiz-profiles.json');
const NOW = Date.parse(file.clock);
const H = 3_600_000;
const NEUTRAL = { intent: 'unclear', excludedNames: [], preferredNames: [] };

/** Any field that would carry a standing rule, its version or its notice. None may come out of the private path. */
const STANDING_KEYS = /standing|rule_?version|notice_?version|automatic/i;
function keysOf(v: unknown, out: string[] = []): string[] {
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysOf(x, out); }
  return out;
}

const run = (c: DecisionCase) => replay(file, c.story, c.candidate, c.recipients, c.steps, c.assessment, c.pauses).outcome;
const ready = file.cases.flatMap((c) => {
  const o = run(c);
  return o.kind === 'ready_for_preview' ? [{ c, o }] : [];
});
/** C3 categories a preview payload uses (what `approve_signal_standing` would ask the rule to cover). */
const categoriesOf = (cand: { supportMode?: unknown; availability?: unknown }) => [
  ...(cand.supportMode !== undefined ? ['support_preference'] : []),
  ...(cand.availability !== undefined ? ['coarse_availability'] : []),
];
const preset = (o: Partial<StandingPresetState> = {}): StandingPresetState => ({
  allowedCategories: ['support_preference', 'coarse_availability'], version: 1, assignmentVersion: 1,
  expiresAtMs: NOW + 60 * 24 * H, revoked: false, ...o,
});
/** A rule the owner explicitly set on the setup screen for this pair (the only way one exists). */
const ruleFor = (pairId: string, o: Partial<StandingRuleState> = {}): StandingRuleState => ({
  ruleId: `rule-${pairId}`, ownerId: file.ownerId, recipientId: file.people[pairId]!.recipientId, pairId,
  categories: ['support_preference', 'coarse_availability'], recipientPolicyVersion: 1, presetAssignmentVersion: 1,
  noticeVersion: STANDING_CONSENT_VERSION, version: 1, expiresAtMs: NOW + 7 * 24 * H, revokedAtMs: null, expiredMarked: false, ...o,
});
const expectFor = ({ o }: typeof ready[number], ruleVersion?: number) => ({
  ownerId: file.ownerId, recipientId: file.people[o.recipient.pairId]!.recipientId, pairId: o.recipient.pairId,
  categories: categoriesOf(o.candidate), ...(ruleVersion === undefined ? {} : { ruleVersion }),
});

test('fixture: some cases reach a preview, so the checks below are not vacuous', () => {
  assert.ok(ready.length >= 5, `only ${ready.length} ready previews`);
  assert.ok(ready.some(({ o }) => categoriesOf(o.candidate).includes('coarse_availability')));
});

test('journal + assessment: no decision-loop output carries a standing rule, and a ready preview alone never stands', () => {
  for (const c of file.cases) {
    const o = run(c);
    const s = surfacesOf(file, o);
    const keys = keysOf({ o, s, nudge: nudgeAfterApproval(file, o, s, c.id) });
    assert.deepEqual(keys.filter((k) => STANDING_KEYS.test(k)), [], c.id);
  }
  // However confident the assessment (support intent, a preferred name), without an owner-set rule the answer is no_rule.
  for (const r of ready) assert.equal(standingRuleStands(null, preset(), expectFor(r), NOW), 'no_rule', r.c.id);
});

test('journal + assessment: output that tries to grant a rule is rejected by the strict schemas and never previews', () => {
  const grant = { standingConsent: true, ruleVersion: 1, noticeVersion: STANDING_CONSENT_VERSION };
  assert.equal(PrivateAssessmentSchema.safeParse({ ...NEUTRAL, intent: 'support', ...grant }).success, false);
  assert.equal(SignalCandidateSchema.safeParse({ supportMode: 'short_call', ...grant }).success, false);
  assert.equal(PrivateReflectionSchema.safeParse({ schemaVersion: 1, reflection: 'SYNTHETIC: x',
    candidate: { supportMode: 'short_call' }, assessment: NEUTRAL, ...grant }).success, false);
  // Same input without the grant fields previews (positive control); with them, the loop treats the output as invalid.
  const r = ready[0]!;
  assert.equal(replay(file, r.c.story, r.c.candidate, r.c.recipients, r.c.steps, r.c.assessment, r.c.pauses).outcome.kind,
    'ready_for_preview');
  for (const [candidate, assessment] of [[{ ...(r.c.candidate as object), ...grant }, r.c.assessment],
    [r.c.candidate, { ...(r.c.assessment as object), ...grant }]]) {
    const o = replay(file, r.c.story, candidate, r.c.recipients, r.c.steps, assessment, r.c.pauses).outcome;
    assert.notEqual(o.kind, 'ready_for_preview', JSON.stringify(o));
  }
});

test('quiz: no profile, extra or preset draft carries a rule, and quiz drafts cannot stand in for a preset or the notice', () => {
  for (const c of profiles.cases) {
    const profile = buildProfile(c.answers);
    assert.ok(profile.success, c.id);
    const drafts = draftCategoriesFor(null, profile.data);
    const keys = keysOf({ profile: profile.data, extras: buildQuizExtras(c.answers), drafts });
    assert.deepEqual(keys.filter((k) => STANDING_KEYS.test(k)), [], c.id);
    if (drafts.categories.length === 0) continue;
    // Drafts are unsaved suggestions: no saved preset, no shown versions, no notice. The setup guard refuses.
    const g = guardStandingRule({ pairAccepted: true, preset: null, categories: drafts.categories, expiresAtMs: NOW + 7 * 24 * H,
      expectedPolicyVersion: undefined, expectedAssignmentVersion: undefined, noticeVersion: undefined, paused: false, nowMs: NOW });
    assert.equal(g.ok, false, c.id);
  }
});

test('an explicit rule covers only its own pair, recipient and categories (positive control included)', () => {
  for (const r of ready) {
    const pairId = r.o.recipient.pairId;
    assert.equal(standingRuleStands(ruleFor(pairId), preset(), expectFor(r, 1), NOW), null, r.c.id);
    const other = Object.keys(file.people).find((p) => p !== pairId && file.people[p]!.recipientId !== file.people[pairId]!.recipientId)!;
    assert.notEqual(standingRuleStands(ruleFor(other), preset(), expectFor(r, 1), NOW), null, `${r.c.id}: another pair's rule`);
    assert.equal(standingRuleStands(ruleFor(pairId, { recipientId: file.people[other]!.recipientId }), preset(), expectFor(r, 1), NOW),
      'wrong_recipient', r.c.id);
    const cats = categoriesOf(r.o.candidate);
    if (cats.includes('coarse_availability'))
      assert.equal(standingRuleStands(ruleFor(pairId, { categories: ['support_preference'] }), preset(), expectFor(r, 1), NOW),
        'blocked_category', r.c.id);
  }
});

test('pause, revoke, replacement, expiry or a preset change stop queued automatic approvals; resume never re-enables', () => {
  for (const r of ready) {
    const pairId = r.o.recipient.pairId;
    const e = expectFor(r, 1); // the signal was approved under rule version 1 and is still queued
    assert.equal(standingRuleStands(ruleFor(pairId, { revokedAtMs: NOW }), preset(), e, NOW), 'revoked', r.c.id);
    // A D041 pause ends the rule (revokedAt); resuming leaves it ended, and a new rule needs the owner again.
    const paused = ruleFor(pairId, { revokedAtMs: NOW });
    assert.equal(standingRuleStands(paused, preset(), e, NOW + 2 * H), 'revoked', `${r.c.id}: after resume`);
    assert.equal(standingRuleStands(ruleFor(pairId, { version: 2 }), preset(), e, NOW), 'stale_policy', `${r.c.id}: replaced`);
    assert.equal(standingRuleStands(ruleFor(pairId, { expiredMarked: true }), preset(), e, null), 'expired', `${r.c.id}: swept`);
    assert.equal(standingRuleStands(ruleFor(pairId), preset(), e, NOW + 8 * 24 * H), 'expired', `${r.c.id}: past expiry`);
    assert.equal(standingRuleStands(ruleFor(pairId), preset({ version: 2 }), e, NOW), 'stale_policy', `${r.c.id}: preset changed`);
    assert.equal(standingRuleStands(ruleFor(pairId), preset({ revoked: true }), e, NOW), 'stale_policy', `${r.c.id}: preset revoked`);
  }
  const g = (paused: boolean) => guardStandingRule({ pairAccepted: true, preset: preset(), categories: ['support_preference'],
    expiresAtMs: NOW + 7 * 24 * H, expectedPolicyVersion: 1, expectedAssignmentVersion: 1, noticeVersion: STANDING_CONSENT_VERSION,
    paused, nowMs: NOW });
  assert.equal(g(false).ok, true); // positive control
  assert.deepEqual(g(true), { ok: false, reason: 'paused' });
});

test('D041 pause cases: a paused person never reaches a preview, so there is no candidate to approve automatically', () => {
  const pauseCases = file.cases.filter((c) => (c.pauses ?? []).some((p) => p.active && Date.parse(p.expiresAt) > NOW));
  assert.ok(pauseCases.length >= 3);
  for (const c of pauseCases) {
    const o = run(c);
    const paused = new Set(c.pauses!.filter((p) => p.active && Date.parse(p.expiresAt) > NOW).map((p) => p.pairId));
    if (o.kind === 'ready_for_preview') assert.equal(paused.has(o.recipient.pairId), false, c.id);
    assert.equal(surfacesOf(file, o).offered.some((p) => paused.has(p)), false, c.id);
  }
});
