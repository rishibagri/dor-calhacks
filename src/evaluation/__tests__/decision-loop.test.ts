// DS Core 1/2: expected outcomes and paired scenarios for CS's decision loop. Labels in decision-cases.json were
// written before these runs; a case the pipeline does not meet carries knownGap and runs as todo, never relabeled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NUDGE_TEMPLATE_COPY } from '@dor/contracts';
import { SIGNAL_LIFETIME_MS } from '@dor/contracts/policy';
import { buildNudge, matchSignal, recipientNudgeRow } from '../matching.ts';
import type { RecipientNudgeView } from '../../lib/backend/ports.ts';
import { NO_ACTION_COPY, QUESTION_COPY, QUESTION_NOTE } from '../../components/feature/decision-loop-model.ts';
import {
  FORBIDDEN_LABELS, leaksOf, observable, replay, resolveCases, scoreCase, surfacesOf, type DecisionCase,
} from '../decision-loop.ts';

const json = async (u: string) => JSON.parse(await readFile(new URL(u, import.meta.url), 'utf8'));
const raw = await json('../fixtures/decision-cases.json');
const reflections = await json('../../agents/fixtures/reflection.synthetic.json');
const file = resolveCases(raw, reflections);
const byId = (id: string) => file.cases.find((c) => c.id === id)!;
/** The neutral D040 assessment: the loop asks its normal questions (what a missing assessment meant before D042). */
const NEUTRAL = { intent: 'unclear', excludedNames: [], preferredNames: [] };

test('fixture: labels use the README vocabulary and every case covers a pair', () => {
  const kinds = new Set(['no_action', 'needs_clarification', 'ready_for_preview']);
  for (const c of file.cases) {
    assert.ok(kinds.has(c.expected.kind), c.id);
    for (const label of Object.keys(c.forbidden)) assert.ok((FORBIDDEN_LABELS as readonly string[]).includes(label), `${c.id}: ${label}`);
    assert.match(c.story, /^SYNTHETIC:/);
  }
  const pairs = new Set(file.cases.map((c) => c.pair));
  for (const p of ['general-vs-specific', 'explicit-refusal', 'ambiguous-timing', 'skipped-question', 'changed-answer',
    'prompt-injection', 'private-party']) assert.ok(pairs.has(p), p);
  // D040: every case in AI's reflection fixture is evaluated, by reference (no copied story or output).
  const refs = new Set(raw.cases.map((c: { reflectionRef?: string }) => c.reflectionRef).filter(Boolean));
  for (const r of reflections.cases) assert.ok(refs.has(r.id), `reflection case ${r.id} not evaluated`);
  for (const c of raw.cases.filter((c: { reflectionRef?: string }) => c.reflectionRef))
    assert.equal('story' in c || 'candidate' in c || 'assessment' in c, false, `${c.id} duplicates AI fixture data`);
  // Every label is exercised by at least one case.
  for (const label of FORBIDDEN_LABELS) assert.ok(file.cases.some((c) => (c.forbidden[label] ?? []).length > 0), label);
  // All three groups and all three outcomes appear.
  for (const g of ['support', 'avoid', 'uncertain']) assert.ok(file.cases.some((c) => c.group === g), g);
  for (const k of kinds) assert.ok(file.cases.some((c) => c.expected.kind === k), k);
});

for (const c of file.cases) {
  test(`case ${c.id} [${c.pair}/${c.group}] → ${c.expected.kind}`, { todo: c.knownGap }, () => {
    const s = scoreCase(file, c);
    assert.deepEqual(s.leaks, [], `forbidden disclosure: ${JSON.stringify(s.leaks)}`);
    assert.deepEqual(s.excludedSurfaced, [], 'excluded person offered or previewed');
    assert.ok(s.matches, `expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(s.outcome)}`);
    assert.equal(s.unsafe, false, 'unsafe suggestion');
    assert.equal(s.missed, false, 'missed suggestion');
  });
}

test('known gaps still fail as labeled (remove knownGap when this test breaks)', () => {
  const gaps = file.cases.filter((c) => c.knownGap);
  assert.deepEqual(gaps.map((c) => c.id).sort(), []);
  for (const c of gaps) assert.equal(scoreCase(file, c).matches, false, c.id);
});

test('paired: same general willingness, different person-specific intent → different eligibility', () => {
  const yes = scoreCase(file, byId('g1-company-and-this-friend')).outcome;
  const no = scoreCase(file, byId('g2-company-but-not-this-friend')).outcome;
  assert.deepEqual(byId('g1-company-and-this-friend').candidate, byId('g2-company-but-not-this-friend').candidate);
  assert.equal(yes.kind, 'ready_for_preview');
  assert.equal(no.kind, 'no_action');
});

test('paired: general company never generalizes to the only connection', () => {
  const o = scoreCase(file, byId('g3-company-generally-never-auto-picks')).outcome;
  assert.equal(o.kind, 'needs_clarification');
});

test('explicit refusal: the refused person is never offered or previewed at any step', () => {
  const c = byId('r2-refused-person-cannot-be-chosen-or-fallen-through');
  for (let i = 1; i <= c.steps.length; i++) {
    const { state, outcome } = replay(file, c.story, c.candidate, c.recipients, c.steps.slice(0, i));
    if (state.excluded.includes('p-alex')) assert.ok(!surfacesOf(file, outcome).offered.includes('p-alex'), `step ${i}`);
  }
});

test('refusal is narrow-only: an assessment exclusion cannot be undone by the owner choosing that person', () => {
  // Safety property only; the exact outcome kind is r5's own (labeled) case test.
  const s = scoreCase(file, byId('r5-refusal-via-assessment'));
  assert.notEqual(s.outcome.kind, 'ready_for_preview');
  assert.deepEqual(s.excludedSurfaced, []);
});

test('injected candidate: even where decide() passes it through, the exact preview denies it (defense in depth)', () => {
  const c = byId('i2-injected-candidate-fields');
  const { outcome } = replay(file, c.story, c.candidate, c.recipients, c.steps);
  const s = surfacesOf(file, outcome);
  assert.equal(s.preview?.kind ?? 'none', outcome.kind === 'ready_for_preview' ? 'denied' : 'none');
  assert.deepEqual(s.recipient, []);
  assert.deepEqual(leaksOf(file, c, s), []);
});

/** Every prefix of a case's steps, i.e. every screen the owner could see on the way. */
const prefixes = (c: DecisionCase) => Array.from({ length: c.steps.length + 1 }, (_, i) => replay(file, c.story, c.candidate,
  c.recipients, c.steps.slice(0, i), c.assessment, c.pauses));

test('excluded stays excluded: no screen of any case offers or previews a person the episode left out', () => {
  for (const c of file.cases.filter((c) => !c.knownGap)) for (const [i, r] of prefixes(c).entries()) {
    const offered = surfacesOf(file, r.outcome).offered;
    assert.deepEqual(offered.filter((id) => r.excluded.includes(id)), [], `${c.id} step ${i}`);
  }
});

test('no private story without approval: no screen of any case shows a story term; recipient copy only at a preview', () => {
  for (const c of file.cases.filter((c) => !c.knownGap)) for (const [i, r] of prefixes(c).entries()) {
    const s = surfacesOf(file, r.outcome);
    // Story terms apply on every screen. Who counts as unapproved is a final-state label (an owner may pick someone and
    // then change their mind); excluded people are covered on every screen by the test above.
    const final = i === c.steps.length;
    assert.deepEqual(leaksOf(file, c, s).filter((l) => final || l.label !== 'unapproved_recipient'), [], `${c.id} step ${i}`);
    if (r.outcome.kind !== 'ready_for_preview') assert.deepEqual(s.recipient, [], `${c.id} step ${i}`);
  }
});

test('D040 never chooses: with no "who" step, no case reaches ready_for_preview', () => {
  for (const c of file.cases) if (!c.steps.some((s) => 'who' in s))
    assert.notEqual(scoreCase(file, c).outcome.kind, 'ready_for_preview', c.id);
});

test('noninterference: varying only the private story changes nothing visible or scheduled', () => {
  const [first, ...rest] = file.noninterference.stories.map((story) => JSON.stringify(observable(file, story)));
  for (const r of rest) assert.equal(r, first);
  const o = observable(file, file.noninterference.stories[0]!);
  assert.equal(o.outcome.kind, 'ready_for_preview');
  assert.ok(o.nudge && typeof o.nudge === 'object' && 'templateId' in o.nudge, 'positive control produced a nudge');
});

test('fixed copy: no question, note, no-action or template text carries a story term from any case', () => {
  const fixed = [...Object.values(QUESTION_COPY), QUESTION_NOTE, ...Object.values(NO_ACTION_COPY), ...Object.values(NUDGE_TEMPLATE_COPY)];
  const terms = file.cases.flatMap((c) => FORBIDDEN_LABELS.filter((l) => l !== 'unapproved_recipient').flatMap((l) => c.forbidden[l] ?? []));
  for (const text of fixed) for (const t of terms) assert.doesNotMatch(text, new RegExp(`\\b${t}\\b`, 'i'), `${t} in "${text}"`);
  // The README's unacceptable question is not reachable.
  for (const text of fixed) assert.doesNotMatch(text, /ask (them )?about|friday|night/i);
});

test('pause noninterference (D041): pausing a third person changes nothing about the chosen person\'s preview', () => {
  const steps = [{ company: 'company' as const }, { who: 'p-sam' }];
  const pause = { pairId: 'p-alex', version: 1, expiresAt: '2026-10-25T06:00:00Z', active: true, createdAt: '2026-10-24T17:00:00Z' };
  const run = (pauses: typeof pause[]) => {
    const { outcome } = replay(file, 'SYNTHETIC: a short call with Sam would help.', { supportMode: 'short_call' }, ['p-sam', 'p-alex'], steps, NEUTRAL, pauses);
    return JSON.stringify({ outcome, surfaces: surfacesOf(file, outcome) });
  };
  assert.equal(run([pause]), run([]));
  assert.match(run([]), /ready_for_preview/);
});

// core3-audit.md: timing counts as disclosure. Hold everything fixed except when the sender approved.
const nudgeAt = (approvedMinutesBeforeCommit: number) => {
  const now = new Date(file.clock);
  const approvedAt = now.getTime() - approvedMinutesBeforeCommit * 60_000;
  const signal = { schemaVersion: 2, signalId: 'sig-timing', pairId: 'p-sam', senderId: file.ownerId, recipientId: 'friend-sam',
    purpose: 'support_nudge', supportMode: 'short_call', consentVersion: 1, recipientPolicyId: 'decision-eval-policy',
    recipientPolicyVersion: 1, presetAssignmentVersion: 1, expiresAt: new Date(approvedAt + SIGNAL_LIFETIME_MS).toISOString() };
  const ack = { schemaVersion: 1, signalId: 'sig-timing', recipientConsentId: 'consent-1', recipientConsentVersion: 1,
    decision: 'compatible', supportMode: 'short_call' };
  const m = matchSignal({ signal, policy: { allowed: true, reason: 'ok' }, ack, now, inQuietHours: false, lastNudgeAt: null });
  assert.equal(m.outcome, 'nudge');
  return m.outcome === 'nudge' ? buildNudge(signal as never, ack as never, m, { id: 'nudge-timing', now }) : null;
};

test('timing (sender_approval_timing): recipient-visible copy does not depend on when the sender approved', () => {
  assert.equal(NUDGE_TEMPLATE_COPY[nudgeAt(5)!.templateId], NUDGE_TEMPLATE_COPY[nudgeAt(600)!.templateId]);
});

// D043 (Cyber, spacetimedb/src/views.ts + tests/audit_leaks.test.ts): the recipient's row is narrowed. DS mirrors it.
const rowAt = (approvedMinutesBeforeCommit: number) => recipientNudgeRow(nudgeAt(approvedMinutesBeforeCommit)!);
const HOUR_MS = 3_600_000;

test('timing (D043 mirror): the recipient row is exactly {id, pairId, templateId, visibleUntil}, with no ids or times', () => {
  const internal = nudgeAt(37)!;
  const row = recipientNudgeRow(internal);
  assert.deepEqual(Object.keys(row).sort(), ['id', 'pairId', 'templateId', 'visibleUntil']);
  const wire = JSON.stringify(row);
  for (const hidden of [...internal.sourceSignalIds, internal.createdAt, internal.expiresAt]) assert.ok(!wire.includes(hidden), hidden);
});

test('timing (D043 mirror): visibleUntil is the expiry rounded up to a whole hour, never earlier and less than an hour later', () => {
  const internal = nudgeAt(37)!;
  const exact = Date.parse(internal.expiresAt), shown = Date.parse(recipientNudgeRow(internal).visibleUntil);
  assert.notEqual(exact % HOUR_MS, 0); // the exact value was not aligned, so rounding hid something
  assert.equal(shown % HOUR_MS, 0);
  assert.ok(shown >= exact && shown - exact < HOUR_MS);
});

test('timing (D043 mirror): approvals within the same hour give the recipient identical rows', () => {
  const { id: _a, ...early } = rowAt(5);
  const { id: _b, ...late } = rowAt(30);
  assert.deepEqual(early, late);
});

test('timing (D043 mirror): the DS row has the shape CS consumes (RecipientNudgeView; checked by npm run typecheck)', () => {
  const row = rowAt(5) satisfies RecipientNudgeView;
  const cs: Record<keyof RecipientNudgeView, true> = { id: true, pairId: true, templateId: true, visibleUntil: true };
  assert.deepEqual(Object.keys(row).sort(), Object.keys(cs).sort());
});

// sender_approval_timing, relabeled: D043 sets visible_until = ceil_hour(approval + 24 h), so the approval hour is
// recoverable. Cyber accepted that as a D043 residual (Sumedh, Option A, as reported by the DS owner on 2026-10-24; not
// recorded in the repository). The earlier label "the row does not encode approval time" was a todo; the label is now
// "at most the approval hour": exact minute/second approval time and any extra identifying field stay hidden.
const APPROVAL_OFFSETS = Array.from({ length: 1439 }, (_, i) => i + 1); // every minute of the signal lifetime
const approvedAtFor = (m: number) => Date.parse(file.clock) - m * 60_000;
function approvalTimingFindings(rowFor: (approvedMinutesBeforeCommit: number) => object): string[] {
  const findings = new Set<string>();
  const byHour = new Map<number, string>();
  for (const m of APPROVAL_OFFSETS) {
    const internal = nudgeAt(m)!, approvedAt = approvedAtFor(m);
    const { id: _id, ...row } = rowFor(m) as Record<string, unknown>;
    if (Object.keys(row).sort().join() !== 'pairId,templateId,visibleUntil') findings.add('extra or missing field');
    const shown = Date.parse(String(row.visibleUntil));
    if (!Number.isFinite(shown) || shown % HOUR_MS !== 0) findings.add('visibleUntil finer than an hour');
    const wire = JSON.stringify(row);
    // An approval exactly on the hour has an hour-aligned expiry that rounding leaves unchanged; the same-hour check
    // below covers it, so exact values are only searched when they carry sub-hour detail.
    const exactTimes = approvedAt % HOUR_MS === 0 ? [] : [new Date(approvedAt).toISOString(), internal.expiresAt, String(approvedAt), String(Date.parse(internal.expiresAt))];
    for (const exact of [...exactTimes, internal.createdAt, ...internal.sourceSignalIds]) if (wire.includes(exact)) findings.add('exact time or id on the wire');
    const hour = Math.ceil(approvedAt / HOUR_MS); // approvals in the same clock hour must be indistinguishable
    if ((byHour.get(hour) ?? wire) !== wire) findings.add('approvals in the same hour are distinguishable');
    byHour.set(hour, wire);
  }
  return [...findings];
}

test('timing (sender_approval_timing): the recipient row reveals at most the approval hour (D043 accepted residual)', () => {
  assert.deepEqual(approvalTimingFindings(rowAt), []);
  // The accepted residual, stated rather than hidden: different approval hours can show different hours.
  const { id: _a, ...early } = rowAt(5);
  const { id: _b, ...late } = rowAt(600);
  assert.notDeepEqual(early, late);
  assert.equal((Date.parse(early.visibleUntil) - Date.parse(late.visibleUntil)) % HOUR_MS, 0);
});

test('timing (sender_approval_timing): negative controls, so a finer-grained or wider row fails the check', () => {
  const unrounded = (m: number) => ({ ...rowAt(m), visibleUntil: nudgeAt(m)!.expiresAt });
  const toTheMinute = (m: number) => ({ ...rowAt(m), visibleUntil: new Date(Math.ceil(Date.parse(nudgeAt(m)!.expiresAt) / 60_000) * 60_000).toISOString() });
  const approvedAtField = (m: number) => ({ ...rowAt(m), approvedAt: new Date(approvedAtFor(m)).toISOString() });
  assert.ok(approvalTimingFindings(unrounded).includes('exact time or id on the wire'));
  assert.ok(approvalTimingFindings(toTheMinute).includes('visibleUntil finer than an hour'));
  assert.ok(approvalTimingFindings(toTheMinute).includes('approvals in the same hour are distinguishable'));
  assert.ok(approvalTimingFindings(approvedAtField).includes('extra or missing field'));
  assert.ok(approvalTimingFindings(approvedAtField).includes('exact time or id on the wire'));
});


test('per-entry space still ends in no_action (unaffected by the f4 quiz relabel)', () => {
  for (const id of ['a11-wants-space', 'a12-wants-space-overrides-a-candidate', 'c1-changed-to-space']) {
    const s = scoreCase(file, byId(id));
    assert.equal(s.outcome.kind, 'no_action', id);
    assert.equal(s.matches, true, id);
    assert.deepEqual(surfacesOf(file, s.outcome).recipient, [], id);
  }
});

test('D042: a candidate without an assessment never reaches a question or a preview, at any step', () => {
  const c = byId('r4m-refusal-in-entry-assessment-missing');
  assert.equal(c.assessment, null);
  for (const r of prefixes(c)) {
    assert.deepEqual(r.outcome, { kind: 'no_action', reason: 'assessment_missing' });
    assert.deepEqual(surfacesOf(file, r.outcome).offered, []);
  }
  // Same entry and taps with the assessment r4 carries: Alex is left out and Sam is asked about.
  assert.equal(scoreCase(file, byId('r4-refusal-stated-only-in-entry')).outcome.kind, 'needs_clarification');
  // Every candidate case with a missing assessment fails closed, whatever the owner taps.
  for (const k of file.cases.filter((k) => k.assessment == null && k.candidate != null))
    assert.equal(scoreCase(file, k).outcome.kind, 'no_action', k.id);
});

test('D042 neutral assessment reproduces the old "ask normally" path exactly', () => {
  const neutral = file.cases.filter((c) => JSON.stringify(c.assessment) === JSON.stringify(NEUTRAL));
  assert.ok(neutral.length >= 25, `${neutral.length}`); // 25 DS cases + AI reference cases that carry the same assessment
  for (const c of neutral) {
    const withNeutral = replay(file, c.story, c.candidate, c.recipients, c.steps, NEUTRAL, c.pauses).outcome;
    const oldMissing = replay(file, c.story, c.candidate, c.recipients, c.steps, null, c.pauses, false).outcome;
    assert.deepEqual(withNeutral, oldMissing, c.id);
  }
});

test('nickname exclusions (AI PR #38): "not Alexander" / "not Alex" leave out both spellings, labels unchanged', () => {
  for (const id of ['nn1-nickname-alexander-excludes-alex', 'nn2-nickname-alex-excludes-alexander']) {
    const s = scoreCase(file, byId(id));
    assert.ok(s.matches, id);
    assert.deepEqual(s.leaks, [], id);
    assert.deepEqual(surfacesOf(file, s.outcome).offered, ['p-sam'], id);
  }
});
