/**
 * Invariants I1–I9 (REASONING.md §11), checked over every synthetic scenario and over restricted variants of them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_SURFACE, modeRank } from '../vocabulary.ts';
import { validateDecision } from '../validate.ts';
import { finalize } from '../finalize.ts';
import type { ReasoningDecision, ReasoningEpisodeInput } from '../types.ts';
import { SCENARIOS, buildInput, proposalsFor, runScenario } from '../../reference/scenarios.ts';

const recipientAct = (d: ReasoningDecision) => d.mode === 'act' && d.action !== undefined && ACTION_SURFACE[d.action] === 'recipient';
const clone = (i: ReasoningEpisodeInput): ReasoningEpisodeInput => structuredClone(i);

/** Restrictions that must never raise automation (I7) and must remove recipient acts toward the target (I1). */
const RESTRICTIONS: [string, (i: ReasoningEpisodeInput, target: string) => void][] = [
  ['pause', (i, t) => { i.relationships.find(r => r.ref === t)!.gates.paused = true; }],
  ['opt-out', (i, t) => { i.relationships.find(r => r.ref === t)!.gates.optedOut = true; }],
  ['cooldown', (i, t) => { i.relationships.find(r => r.ref === t)!.gates.cooldownUntil = '2026-10-26T18:00:00Z'; }],
  ['quiet hours', (i, t) => { i.relationships.find(r => r.ref === t)!.gates.quietHoursNow = true; }],
  ['preset revoked', (i, t) => { i.relationships.find(r => r.ref === t)!.gates.presetRevoked = true; }],
  ['exclusion', (i, t) => { i.explicitIntent.excludedRefs.push(t); }],
  ['relationship conflict', (i, t) => { i.relationships.find(r => r.ref === t)!.conflict = 'unresolved'; }],
  ['episode conflict', (i) => { i.hardStops.risk = 'interpersonal_conflict'; }],
  ['wants space', (i) => { i.explicitIntent.wantsSpace = true; }],
  ['context expired', (i) => { i.now = '2026-11-30T00:00:00Z'; }],
  ['urgent support', (i) => { i.hardStops.risk = 'urgent_support'; }],
  ['assessment invalid', (i) => { i.hardStops.assessmentValid = false; }],
];

test('I1 + I7: no restriction is bypassed, and no restriction ever raises automation', () => {
  let checked = 0;
  for (const s of SCENARIOS) {
    const base = runScenario(s);
    const target = base.targetRef ?? s.episode.relationships[0]!.ref;
    for (const [name, restrict] of RESTRICTIONS) {
      const i = clone(buildInput(s));
      restrict(i, target);
      const d = runScenario(s, { input: i });
      assert.ok(modeRank(d.mode) <= modeRank(base.mode), `${s.id} + ${name}: ${base.mode} → ${d.mode}`);
      assert.ok(!(recipientAct(d) && d.targetRef === target), `${s.id} + ${name}: still acts toward ${target}`);
      checked++;
    }
  }
  assert.equal(checked, SCENARIOS.length * RESTRICTIONS.length);
});

test('I2: hard stop or invalid input ⇒ abstain, for every scenario', () => {
  for (const s of SCENARIOS) {
    for (const mutate of [(i: ReasoningEpisodeInput) => { i.hardStops.risk = 'urgent_support'; },
      (i: ReasoningEpisodeInput) => { i.hardStops.assessmentValid = false; }]) {
      const i = clone(buildInput(s));
      mutate(i);
      assert.equal(runScenario(s, { input: i }).mode, 'abstain', s.id);
    }
    assert.equal(finalize({ ...buildInput(s), extra: true }, proposalsFor(s)).mode, 'abstain', s.id);
  }
});

test('I3: interpersonal conflict ⇒ no recipient-facing action, even for adversarial proposals', () => {
  for (const s of SCENARIOS) {
    const i = clone(buildInput(s));
    i.hardStops.risk = 'interpersonal_conflict';
    const d = runScenario(s, { input: i, options: { allowUnnamedTargets: true } });
    assert.ok(!d.action || ACTION_SURFACE[d.action] !== 'recipient' || d.mode !== 'act', s.id);
    assert.ok(!(d.action && ACTION_SURFACE[d.action] === 'recipient'), `${s.id}: recipient action survived conflict`);
  }
});

test('I4 + I5: every decision validates; defer carries no action; DEFER and ABSTAIN are always in the record', () => {
  for (const s of SCENARIOS) {
    for (const options of [{}, { allowUnnamedTargets: true }]) {
      const d = runScenario(s, { options });
      assert.ok(validateDecision(d), s.id);
      if (d.mode === 'defer') assert.ok(d.reassess && !d.action && !d.targetRef && !d.deliveryMapping, s.id);
      const record = [d.mode === 'abstain' ? 'ABSTAIN' : d.mode === 'defer' ? 'DEFER' : d.action, ...d.rejected.map(r => r.action)];
      assert.ok(record.includes('ABSTAIN') && record.includes('DEFER'), `${s.id}: ${record}`);
    }
  }
});

test('I6: expired context never acts or asks; the core computes expiry and never extends it', () => {
  for (const s of SCENARIOS) {
    const i = clone(buildInput(s));
    i.now = '2026-11-30T00:00:00Z';
    const d = runScenario(s, { input: i, options: { allowUnnamedTargets: true } });
    assert.ok(d.mode === 'abstain' || d.mode === 'defer', `${s.id}: ${d.mode}`);
    assert.equal(d.freshness, 'expired');
    assert.equal(d.contextExpiresAt, runScenario(s).contextExpiresAt);
  }
});

test('I8: determinism — same input, proposals and options ⇒ identical decision', () => {
  for (const s of SCENARIOS) assert.deepEqual(runScenario(s), runScenario(s), s.id);
});

test('I9: an intervention without evidence, or citing evidence absent from the episode, is rejected', () => {
  for (const s of SCENARIOS) {
    const base = runScenario(s, { options: { allowUnnamedTargets: true } });
    if (base.mode !== 'act' && base.mode !== 'ask') continue;
    for (const refs of [[], ['made:up']]) {
      const proposals = proposalsFor(s).map(p => (p.action === base.action && p.targetRef === base.targetRef ? { ...p, evidenceRefs: refs } : p));
      const d = finalize(buildInput(s), proposals, { allowUnnamedTargets: true });
      assert.ok(!(d.action === base.action && d.targetRef === base.targetRef), `${s.id}: unsupported proposal selected`);
      assert.ok(d.rejected.some(r => r.action === base.action && r.reason === 'unsupported_by_evidence'), s.id);
    }
  }
});

test('more proactive and more restrained than the current loop, depending on context', () => {
  const by = (id: string) => runScenario(SCENARIOS.find(s => s.id === id)!);
  // Proactive: no person named in the entry, yet a justified opportunity is surfaced.
  assert.equal(by('s09-silence-natural-opening').mode, 'ask');
  assert.equal(runScenario(SCENARIOS.find(s => s.id === 's01-exam-friend-free-soon')!).mode, 'act');
  // Restrained: a named best friend with a clear, deliverable channel still does not get an automated note.
  const great = by('s03-great-news-best-friend');
  assert.equal(great.surface, 'owner');
  assert.equal(great.deliveryMapping, undefined);
  assert.equal(by('s12-rough-week-now-at-dinner').mode, 'abstain');
});
