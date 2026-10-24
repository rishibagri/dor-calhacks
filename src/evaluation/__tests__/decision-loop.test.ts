// DS Core 1/2: expected outcomes and paired scenarios for CS's decision loop. Labels in decision-cases.json were
// written before these runs; a case the pipeline does not meet carries knownGap and runs as todo, never relabeled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NUDGE_TEMPLATE_COPY } from '@dor/contracts';
import { NO_ACTION_COPY, QUESTION_COPY, QUESTION_NOTE } from '../../components/feature/decision-loop-model.ts';
import {
  FORBIDDEN_LABELS, leaksOf, observable, replay, resolveCases, scoreCase, surfacesOf, type DecisionCase,
} from '../decision-loop.ts';

const json = async (u: string) => JSON.parse(await readFile(new URL(u, import.meta.url), 'utf8'));
const raw = await json('../fixtures/decision-cases.json');
const reflections = await json('../../agents/fixtures/reflection.synthetic.json');
const file = resolveCases(raw, reflections);
const byId = (id: string) => file.cases.find((c) => c.id === id)!;

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
  assert.deepEqual(gaps.map((c) => c.id).sort(), ['i2-injected-candidate-fields', 'r4m-refusal-in-entry-assessment-missing']);
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
  c.recipients, c.steps.slice(0, i), c.assessment));

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
