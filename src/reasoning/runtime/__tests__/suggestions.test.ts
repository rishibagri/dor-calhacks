import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CANDIDATES, MAX_PICKS, fallbackPicks, rankCandidates, validatePicks, type SuggestionItem } from '../suggestions.ts';

const NOW = '2026-10-25T18:00:00Z';
const item = (id: string, over: Partial<SuggestionItem> = {}): SuggestionItem => ({
  id, kind: 'event', title: 'Something', tags: [], keywords: [], summary: '', areaKey: 'berkeley-campus',
  startsAt: '2026-10-27T02:00:00Z', rating: null, reviews: null, label: '', ...over,
});
const ctx = { interests: ['board-games', 'hiking'], memory: ['wants to try climbing'], areaKey: 'berkeley-campus', now: NOW };

test('interest overlap ranks first, then memory, then area; past events are dropped', () => {
  const ranked = rankCandidates([
    item('far', { areaKey: 'sf-soma' }),
    item('games', { tags: ['board-games'] }),
    item('climb', { kind: 'place', startsAt: null, keywords: ['climbing'], rating: 4.6, reviews: 400 }),
    item('past', { tags: ['board-games'], startsAt: '2026-10-20T00:00:00Z' }),
  ], ctx);
  assert.deepEqual(ranked.map((r) => r.id).slice(0, 2), ['games', 'climb']);
  assert.ok(!ranked.some((r) => r.id === 'past'));
});

test('candidate list is bounded', () => {
  const many = Array.from({ length: 200 }, (_, n) => item(`e${n}`));
  assert.equal(rankCandidates(many, ctx).length, MAX_CANDIDATES);
});

test('model picks: only shown ids, no duplicates, short single-line reasons without links, capped', () => {
  const shown = [item('a'), item('b'), item('c')];
  const picks = validatePicks([
    { id: 'a', why: 'you love board games\nand it is close https://evil.example' },
    { id: 'a', why: 'dup' }, { id: 'zzz', why: 'invented' }, { id: 'b' }, { id: 'c', why: 'x'.repeat(300) },
  ], shown);
  assert.deepEqual(picks.map((p) => p.id), ['a', 'b', 'c']);
  assert.ok(!picks[0]!.why.includes('http') && !picks[0]!.why.includes('\n'));
  assert.ok(picks[2]!.why.length <= 90);
  assert.deepEqual(validatePicks('garbage', shown), []);
  assert.ok(validatePicks(Array.from({ length: 20 }, (_, n) => ({ id: `e${n}`, why: 'ok' })), Array.from({ length: 20 }, (_, n) => item(`e${n}`))).length <= MAX_PICKS);
});

test('fallback picks explain the shared interest', () => {
  const picks = fallbackPicks(rankCandidates([item('games', { tags: ['board-games'] })], ctx), ctx);
  assert.equal(picks[0]!.why, 'you’re into board games');
});
