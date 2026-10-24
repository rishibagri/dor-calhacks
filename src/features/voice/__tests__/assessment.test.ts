import test from 'node:test';
import assert from 'node:assert/strict';
import fixtures from '../../../agents/fixtures/reflection.synthetic.json' with { type: 'json' };
import { answerCompany, answerWho, decide, excludeForNow, type LoopState, type Recipient }
  from '../../../components/feature/decision-loop-model.ts';
import { assessedRecipients, initialLoopState, leftOutByAssessment, nameMatches, suggestsNothing } from '../assessment.ts';

// SYNTHETIC connections. Two Alexes exercise the ambiguous-exclusion rule.
const SAM = { pairId: 'p-sam', name: 'Sam Rivera' };
const ALEX = { pairId: 'p-alex', name: 'Alex Kim' };
const ALEX2 = { pairId: 'p-alex2', name: 'Alex Moreno' };
const JO = { pairId: 'p-jo', name: 'José-Luis' };
const PEOPLE: Recipient[] = [ALEX, SAM, ALEX2, JO];
const CALL = { supportMode: 'short_call' as const };
const A = (intent: string, excludedNames: string[] = [], preferredNames: string[] = []) => ({ intent, excludedNames, preferredNames });

/** One render of the loop as DecisionLoop does it: assessed recipients, then CS's decide(). */
const view = (s: LoopState, assessment: unknown, people: readonly Recipient[] = PEOPLE) =>
  decide(s, assessedRecipients(people, assessment));

test('names match whole words only, case- and accent-insensitive; never prefixes', () => {
  assert.equal(nameMatches('alex', 'Alex Kim'), true);
  assert.equal(nameMatches('Alex Kim', 'Alex Kim'), true);
  assert.equal(nameMatches('Al', 'Alex Kim'), false);
  assert.equal(nameMatches('Alex Moreno', 'Alex Kim'), false);
  assert.equal(nameMatches('jose luis', 'José-Luis'), true);
  assert.equal(nameMatches('Kim', 'Alex Kim'), true, 'a surname the owner wrote still refers to them');
  assert.equal(nameMatches('', 'Alex Kim'), false);
});

test('no assessment: the loop is exactly CS behavior (asks company first, offers everyone)', () => {
  const s = initialLoopState(CALL, undefined);
  assert.deepEqual(view(s, undefined), { kind: 'needs_clarification', question: 'company', options: PEOPLE });
});

test('wants_space and invalid assessments end in no action and hide the share step', () => {
  for (const bad of [A('wants_space'), A('send_now'), { intent: 'wants_connection' }, A('unclear', ['x'.repeat(41)]),
    A('wants_connection', ['Alex'], ['alex'])]) {
    assert.equal(suggestsNothing(CALL, bad), true, JSON.stringify(bad));
    assert.deepEqual(view(initialLoopState(CALL, bad), bad), { kind: 'no_action', reason: 'nothing_to_share' });
  }
  assert.deepEqual(assessedRecipients(PEOPLE, A('send_now')), [], 'invalid → offer no one');
  assert.equal(suggestsNothing(null, A('wants_connection')), true, 'no candidate → nothing, whatever the assessment');
});

test('wants_connection skips only the company question; the owner still chooses who', () => {
  const a = A('wants_connection');
  const s = initialLoopState(CALL, a);
  const out = view(s, a);
  assert.equal(out.kind, 'needs_clarification');
  assert.equal(out.kind === 'needs_clarification' && out.question, 'who');
  assert.equal(s.chosen, null, 'never pre-chosen');
});

test('positive Sam: Sam is listed first but not chosen; preview only after the owner picks Sam', () => {
  const a = A('wants_connection', [], ['Sam']);
  const s = initialLoopState(CALL, a);
  const out = view(s, a);
  assert.equal(out.kind === 'needs_clarification' && out.options[0]?.pairId, SAM.pairId);
  const picked = view(answerWho(s, SAM.pairId), a);
  assert.deepEqual(picked, { kind: 'ready_for_preview', recipient: SAM, candidate: CALL });
});

test('"not Alex tonight": every Alex is left out (ambiguous → exclude all), never replaced automatically', () => {
  const a = A('wants_connection', ['Alex']);
  const s = initialLoopState(CALL, a);
  const out = view(s, a);
  assert.deepEqual(out.kind === 'needs_clarification' && out.options.map(r => r.pairId), [SAM.pairId, JO.pairId]);
  assert.deepEqual(leftOutByAssessment(PEOPLE, a).map(r => r.pairId), [ALEX.pairId, ALEX2.pairId]);
  // Even if the UI tried to pick an excluded Alex, decide() finds no eligible recipient and never guesses another.
  assert.deepEqual(view(answerWho(s, ALEX.pairId), a), { kind: 'no_action', reason: 'no_recipient' });
  // Only Alexes connected: nobody left → no action, not a fallback to someone else.
  assert.deepEqual(view(s, a, [ALEX, ALEX2]), { kind: 'no_action', reason: 'no_eligible_recipient' });
});

test('exclusions apply to connections that load after the loop started (re-derived every render)', () => {
  const a = A('unclear', ['Alex']);
  const s = answerCompany(initialLoopState(CALL, a), 'company');
  assert.deepEqual(view(s, a, [SAM]).kind === 'needs_clarification' && view(s, a, [SAM]), { kind: 'needs_clarification', question: 'who', options: [SAM] });
  const later = view(s, a, [SAM, ALEX]);
  assert.deepEqual(later.kind === 'needs_clarification' && later.options, [SAM]);
});

test('unclear keeps both owner questions; skip or space still means no action', () => {
  const a = A('unclear');
  const s = initialLoopState(CALL, a);
  assert.equal(view(s, a).kind === 'needs_clarification' && view(s, a).kind, 'needs_clarification');
  assert.deepEqual(view(answerCompany(s, 'skip'), a), { kind: 'no_action', reason: 'skipped' });
  assert.deepEqual(view(answerCompany(s, 'space'), a), { kind: 'no_action', reason: 'prefers_space' });
});

test('invariant: no assessment ever reaches a preview without the owner choosing the person', () => {
  const intents = ['wants_connection', 'unclear', 'wants_space', 'bogus'];
  const nameSets = [[], ['Alex'], ['Sam'], ['Alex', 'Sam', 'José-Luis']];
  for (const intent of intents) for (const ex of nameSets) for (const pr of nameSets) {
    const a = A(intent, ex, pr.filter(p => !ex.includes(p)));
    let s = initialLoopState(CALL, a);
    assert.equal(s.chosen, null);
    // Every owner action except choosing a person: none of them may produce a preview.
    for (const step of [(x: LoopState) => x, (x: LoopState) => answerCompany(x, 'company'),
      (x: LoopState) => excludeForNow(x, SAM.pairId), (x: LoopState) => answerWho(x, 'none')]) {
      s = step(s);
      assert.notEqual(view(s, a).kind, 'ready_for_preview', JSON.stringify({ a, s }));
    }
  }
});

test('synthetic Claude fixtures drive the loop as the spec table says', () => {
  const byId = Object.fromEntries((fixtures as { cases: { id: string; output: { candidate: typeof CALL | null; assessment?: unknown } }[] })
    .cases.map(c => [c.id, c.output]));
  const first = (id: string) => { const o = byId[id]!; return view(initialLoopState(o.candidate, o.assessment), o.assessment); };
  assert.equal(first('wants-space').kind, 'no_action');
  assert.equal(first('crisis-language').kind, 'no_action');
  assert.equal(first('private-party').kind, 'no_action', 'no candidate → no questions about the party, Friday or Jordan');
  const unsure = first('unsure');
  assert.equal(unsure.kind === 'needs_clarification' && unsure.question, 'company');
  const notAlex = first('not-alex');
  assert.deepEqual(notAlex.kind === 'needs_clarification' && notAlex.options.map(r => r.pairId), [SAM.pairId, JO.pairId]);
  const sam = first('positive-sam');
  assert.equal(sam.kind === 'needs_clarification' && sam.options[0]?.pairId, SAM.pairId);
});
