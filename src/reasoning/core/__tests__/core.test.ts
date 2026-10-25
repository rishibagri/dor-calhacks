import test from 'node:test';
import assert from 'node:assert/strict';
import { contextExpiresAt, effectiveWindowMinutes, freshnessOf } from '../window.ts';
import { finalize } from '../finalize.ts';
import { selectSurvivor } from '../select.ts';
import { summarize } from '../summary.ts';
import { validateDecision, validateInput, validateProposal } from '../validate.ts';
import type { CandidateProposal, ReasoningEpisodeInput } from '../types.ts';
import { OPEN_GATES } from '../../reference/scenarios.ts';

const NOW = '2026-10-25T18:00:00Z';
const input = (over: Partial<ReasoningEpisodeInput> = {}): ReasoningEpisodeInput => ({
  schemaVersion: 1, episodeId: 'unit', now: NOW,
  hardStops: { risk: 'none', assessmentValid: true },
  explicitIntent: { wantsSpace: false, doesNotWantToTalk: false, excludedRefs: [], namedRefs: ['p-a', 'p-b'] },
  window: { startedAt: '2026-10-25T17:00:00Z', inferredMinutes: 240, confidence: 'high', fallbackMinutes: 60 },
  relationships: [
    { ref: 'p-a', gates: OPEN_GATES, conflict: 'none', sensitiveTopics: [] },
    { ref: 'p-b', gates: OPEN_GATES, conflict: 'none', sensitiveTopics: [] },
  ],
  evidence: ['e1', 'e2'],
  ...over,
});
const invite = (over: Partial<CandidateProposal> = {}): CandidateProposal => ({
  rank: 1, action: 'CASUAL_INVITE', targetRef: 'p-a', requestedMode: 'act', evidenceRefs: ['e1'], judgments: {},
  revealValue: 'low', timing: { kind: 'now' }, confidence: 'high', rationale: [], ...over,
});
const abstainP: CandidateProposal = { rank: 5, action: 'ABSTAIN', requestedMode: 'abstain', evidenceRefs: [], judgments: {},
  revealValue: 'none', timing: { kind: 'now' }, confidence: 'high', rationale: ['no_relational_value'] };

test('window: inferred length when confidence ≥ medium, fallback otherwise; not tied to reveal value', () => {
  const w = { startedAt: '2026-10-25T17:00:00Z', inferredMinutes: 240, confidence: 'high' as const, fallbackMinutes: 60 };
  assert.equal(effectiveWindowMinutes(w), 240);
  assert.equal(effectiveWindowMinutes({ ...w, confidence: 'low' }), 60);
  assert.equal(effectiveWindowMinutes({ ...w, inferredMinutes: undefined }), 60);
  assert.equal(contextExpiresAt(w), '2026-10-25T21:00:00.000Z');
  assert.equal(freshnessOf(w, '2026-10-25T18:00:00Z'), 'fresh');
  assert.equal(freshnessOf(w, '2026-10-25T20:00:00Z'), 'aging');
  assert.equal(freshnessOf(w, '2026-10-25T21:00:00Z'), 'expired');
});

test('validation: unknown keys and malformed input are rejected; invalid input abstains', () => {
  assert.ok(validateInput(input()));
  assert.equal(validateInput({ ...input(), journal: 'secret' }), false);
  assert.equal(validateInput({ ...input(), now: 'yesterday' }), false);
  assert.equal(validateProposal({ ...invite(), story: 'x' }), false);
  assert.equal(validateProposal({ ...invite(), requestedMode: 'defer' }), false, 'a targeted action cannot defer');
  assert.equal(validateProposal({ ...invite(), action: 'DEFER', targetRef: undefined, requestedMode: 'defer' }), false, 'defer needs a reassessment condition');
  const d = finalize({ ...input(), journal: 'secret' }, [invite()]);
  assert.equal(d.mode, 'abstain');
  assert.deepEqual(d.reasons, ['invalid_input']);
});

test('a clean, named, open, evidenced invite becomes act with the existing delivery mapping', () => {
  const d = finalize(input(), [invite(), abstainP]);
  assert.equal(d.mode, 'act');
  assert.equal(d.deliveryMapping?.supportMode, 'shared_activity');
  assert.ok(validateDecision(d));
});

test('caps lower act to ask and record why: reveal value, sensitive topic, low confidence, unnamed, no template', () => {
  const cases: [Partial<CandidateProposal>, ReasoningEpisodeInput, string][] = [
    [{ revealValue: 'high' }, input(), 'high_reveal_value'],
    [{ topic: 'interviews' }, input({ relationships: [{ ref: 'p-a', gates: OPEN_GATES, conflict: 'none', sensitiveTopics: ['interviews'] }] }), 'sensitive_topic'],
    [{ confidence: 'low' }, input(), 'low_confidence'],
    [{ confidence: 'unknown' }, input(), 'low_confidence'],
    [{}, input({ explicitIntent: { wantsSpace: false, doesNotWantToTalk: false, excludedRefs: [], namedRefs: [] } }), 'unnamed_target'],
    [{ action: 'CELEBRATE' }, input(), 'no_delivery_path'],
  ];
  for (const [over, inp, by] of cases) {
    const d = finalize(inp, [invite(over), abstainP]);
    assert.equal(d.mode, 'ask', by);
    assert.deepEqual(d.capped, { from: 'act', by });
    assert.equal(d.deliveryMapping, undefined);
  }
});

test('even a proposer that ranks an automated celebration first cannot automate a high-reveal moment', () => {
  const d = finalize(input(), [invite({ action: 'CELEBRATE', revealValue: 'high', rank: 0 }), abstainP]);
  assert.equal(d.mode, 'ask');
  assert.equal(d.capped?.by, 'high_reveal_value');
});

test('server-gate mirrors reject recipient actions: pause, opt-out, preset, cooldown, quiet hours', () => {
  const g = (over: Partial<typeof OPEN_GATES>, reason: string) => {
    const d = finalize(input({ relationships: [{ ref: 'p-a', gates: { ...OPEN_GATES, ...over }, conflict: 'none', sensitiveTopics: [] }] }), [invite(), abstainP]);
    assert.equal(d.mode, 'abstain', reason);
    assert.ok(d.rejected.some(r => r.action === 'CASUAL_INVITE' && r.reason === reason), reason);
  };
  g({ paused: true }, 'gate_paused');
  g({ optedOut: true }, 'gate_opted_out');
  g({ presetRevoked: true }, 'gate_preset');
  g({ presetCategories: ['coarse_availability'] }, 'gate_preset');
  g({ cooldownUntil: '2026-10-25T20:00:00Z' }, 'gate_cooldown');
  g({ quietHoursNow: true }, 'gate_quiet_hours');
  // The default preset (both categories) is not a refusal.
  assert.equal(finalize(input(), [invite(), abstainP]).mode, 'act');
});

test('explicit intent: wanting space rejects every intervention; "don\'t want to talk" rejects a check-in only', () => {
  const space = finalize(input({ explicitIntent: { wantsSpace: true, doesNotWantToTalk: false, excludedRefs: [], namedRefs: ['p-a'] } }),
    [invite(), invite({ action: 'HELP_USER_REACH_OUT' }), abstainP]);
  assert.equal(space.mode, 'abstain');
  const quiet = input({ explicitIntent: { wantsSpace: false, doesNotWantToTalk: true, excludedRefs: [], namedRefs: ['p-a'] } });
  assert.equal(finalize(quiet, [invite({ action: 'DIRECT_CHECK_IN' }), abstainP]).mode, 'abstain');
  assert.equal(finalize(quiet, [invite(), abstainP]).mode, 'act');
});

test('selection keeps the proposer ranking; exact ties go to less automation, then target ref', () => {
  const s = (p: CandidateProposal, mode: 'act' | 'ask' | 'abstain') => ({ proposal: p, mode });
  assert.equal(selectSurvivor([s(invite({ rank: 2 }), 'act'), s(invite({ rank: 1, targetRef: 'p-b' }), 'act')])?.proposal.targetRef, 'p-b');
  assert.equal(selectSurvivor([s(invite({ rank: 1 }), 'act'), s({ ...abstainP, rank: 1 }, 'abstain')])?.mode, 'abstain');
  assert.equal(selectSurvivor([s(invite({ targetRef: 'p-b' }), 'act'), s(invite(), 'act')])?.proposal.targetRef, 'p-a');
  assert.equal(selectSurvivor([]), null);
  assert.equal(finalize(input(), []).mode, 'abstain', 'no runtime proposals ⇒ abstain');
});

test('summaries are fixed templates: no names, refs or free text', () => {
  const d = finalize(input(), [invite(), abstainP]);
  assert.ok(!/p-a|p-b|e1/.test(d.summary));
  assert.equal(summarize('defer', undefined, ['distress_still_relevant']), 'Look again later from scratch: it may still matter later.');
});
