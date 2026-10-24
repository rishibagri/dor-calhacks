import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_QUESTIONS, NO_ACTION_COPY, QUESTION_COPY, answerCompany, answerWho, applyUnnamedExclusionGuard, decide, excludeForNow, startLoop,
} from '../decision-loop-model.ts';

const SAM = { pairId: 'p-sam', name: 'Sam' };
const ALEX = { pairId: 'p-alex', name: 'Alex' };
const PEOPLE = [SAM, ALEX];
const CALL = { supportMode: 'short_call' as const };

test('positive: company → Sam → exact preview for Sam only (still not a send)', () => {
  let s = startLoop(CALL);
  assert.deepEqual(decide(s, PEOPLE), { kind: 'needs_clarification', question: 'company', options: PEOPLE });
  s = answerCompany(s, 'company');
  assert.equal(decide(s, PEOPLE).kind, 'needs_clarification');
  s = answerWho(s, SAM.pairId);
  assert.deepEqual(decide(s, PEOPLE), { kind: 'ready_for_preview', recipient: SAM, candidate: CALL });
});

test('no candidate means no questions at all', () => {
  assert.deepEqual(decide(startLoop(null), PEOPLE), { kind: 'no_action', reason: 'nothing_to_share' });
});

test('explicit exclusion: "not Alex tonight" removes Alex and never auto-picks another friend', () => {
  let s = answerCompany(startLoop(CALL), 'company');
  s = excludeForNow(s, ALEX.pairId);
  const o = decide(s, PEOPLE);
  assert.equal(o.kind, 'needs_clarification');
  if (o.kind === 'needs_clarification') assert.deepEqual(o.options, [SAM]);
  assert.equal(answerWho(s, ALEX.pairId).chosen, null); // cannot choose an excluded person
  s = answerWho(s, SAM.pairId);
  assert.equal(decide(s, PEOPLE).kind, 'ready_for_preview');
});

test('excluding the chosen person clears the choice and cannot fall through to someone else', () => {
  let s = answerWho(answerCompany(startLoop(CALL), 'company'), ALEX.pairId);
  s = excludeForNow(s, ALEX.pairId);
  assert.equal(s.chosen, null);
  // only one other person exists, but nothing is auto-selected
  assert.equal(decide(s, PEOPLE).kind, 'needs_clarification');
  s = excludeForNow(s, SAM.pairId);
  assert.deepEqual(decide(s, PEOPLE), { kind: 'no_action', reason: 'no_eligible_recipient' });
});

test('uncertain: skipping or preferring space is no action, never an optimistic fallback', () => {
  assert.deepEqual(decide(answerCompany(startLoop(CALL), 'skip'), PEOPLE), { kind: 'no_action', reason: 'skipped' });
  assert.deepEqual(decide(answerCompany(startLoop(CALL), 'space'), PEOPLE), { kind: 'no_action', reason: 'prefers_space' });
  assert.deepEqual(decide(answerWho(answerCompany(startLoop(CALL), 'company'), 'none'), PEOPLE), { kind: 'no_action', reason: 'no_recipient' });
});

test('changed answer: going back to "company" requires choosing the person again', () => {
  let s = answerWho(answerCompany(startLoop(CALL), 'company'), SAM.pairId);
  s = answerCompany(s, 'space');
  assert.equal(decide(s, PEOPLE).kind, 'no_action');
  s = answerCompany(s, 'company');
  assert.equal(s.chosen, null);
  assert.equal(decide(s, PEOPLE).kind, 'needs_clarification');
});

test('change of mind: an exclusion is never undone by a later answer in the same episode', () => {
  let s = excludeForNow(answerCompany(startLoop(CALL), 'company'), ALEX.pairId);
  s = answerCompany(s, 'space');
  s = answerCompany(s, 'company');
  assert.deepEqual(s.excluded, [ALEX.pairId]);
  const o = decide(s, PEOPLE);
  assert.ok(o.kind === 'needs_clarification' && !o.options.some((r) => r.pairId === ALEX.pairId));
});

test('a chosen person who disappears (unlinked) yields no action, not a guess', () => {
  const s = answerWho(answerCompany(startLoop(CALL), 'company'), SAM.pairId);
  assert.deepEqual(decide(s, [ALEX]), { kind: 'no_action', reason: 'no_recipient' });
});

test('question cap: at most two distinct questions; a third new one is no action, never sharing', () => {
  assert.equal(MAX_QUESTIONS, 2);
  const capped = { ...startLoop(CALL), asked: ['who', 'other'] as never };
  assert.deepEqual(decide(capped, PEOPLE), { kind: 'no_action', reason: 'question_cap' });
  // re-showing an already-asked question is allowed
  const again = { ...startLoop(CALL), asked: ['company' as const, 'who' as const] };
  assert.equal(decide(again, PEOPLE).kind, 'needs_clarification');
});

test('private-party case: copy never hints at events, timing, other people or a queued nudge', () => {
  const all = [...Object.values(QUESTION_COPY), ...Object.values(NO_ACTION_COPY)].join(' ');
  assert.doesNotMatch(all, /friday|party|event|tonight|last night|ask (them|about)|they asked|waiting|queued|notif|already told/i);
  for (const q of Object.values(QUESTION_COPY)) assert.doesNotMatch(q, /\{|\}/); // no interpolation slots
});

test('state is plain data: nothing to persist beyond the episode, inputs never mutated', () => {
  const s0 = startLoop(CALL);
  const s1 = answerCompany(s0, 'company');
  excludeForNow(s1, SAM.pairId);
  assert.deepEqual(s0, { candidate: CALL, company: null, chosen: null, excluded: [], asked: [] });
  assert.deepEqual(s1.excluded, []);
});

const UNNAMED = { pairId: 'p-u', name: 'Connection 1', unnamed: true };

test('exclusion present: an unnamed recipient is left out (cannot prove it is not the excluded person)', () => {
  const { kept, leftOutUnnamed } = applyUnnamedExclusionGuard([SAM, UNNAMED], true);
  assert.deepEqual(kept, [SAM]);
  assert.deepEqual(leftOutUnnamed, [UNNAMED]);
});

test('no exclusion: an unnamed recipient stays eligible', () => {
  const { kept, leftOutUnnamed } = applyUnnamedExclusionGuard([SAM, UNNAMED], false);
  assert.deepEqual(kept, [SAM, UNNAMED]);
  assert.deepEqual(leftOutUnnamed, []);
});

test('all recipients left out by the guard ends in the existing no-action state', () => {
  const { kept } = applyUnnamedExclusionGuard([UNNAMED], true);
  const s = answerCompany(startLoop(CALL), 'company');
  assert.deepEqual(decide(s, kept), { kind: 'no_action', reason: 'no_eligible_recipient' });
});
