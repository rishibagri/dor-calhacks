import { openerInputForCard } from '../opener-input.ts';
import { DEMO_FOF_CARDS, DEMO_PROFILE } from '../demo-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapConnectionProfile, mapFofCard, mapNudgeRequest } from '../mappers.ts';
import { knownThrough } from '../types.ts';

test('fof card maps snake or camel rows and drops malformed ones', () => {
  const row = { candidate_ref: 'c1', via_name: 'Sam', hops: 2, mutual_count: 1, shared_tags: ['climbing'], request_status: 'none' };
  assert.deepEqual(mapFofCard(row), {
    candidateRef: 'c1', viaName: 'Sam', hops: 2, mutualCount: 1, sharedTags: ['climbing'], requestStatus: 'none',
  });
  assert.equal(mapFofCard({ ...row, request_status: 'weird' }), null);
  assert.equal(mapFofCard({ candidateRef: 'c1', viaName: 'Sam', hops: 2, mutualCount: 1, sharedTags: 'x', requestStatus: 'none' }), null);
});

test('nudge request keeps an unrevealed counterpart as null', () => {
  const r = mapNudgeRequest({
    request_id: 'r1', direction: 'outgoing', status: 'pending', via_name: 'Sam', hops: 2, shared_tags: [], message: 'hi',
    created_at: { toDate: () => new Date('2026-10-24T00:00:00Z') },
  });
  assert.equal(r?.counterpartName, null);
  assert.equal(r?.createdAt, '2026-10-24T00:00:00.000Z');
  assert.equal(mapNudgeRequest({ request_id: 'r1', direction: 'sideways', status: 'pending', via_name: 'S', hops: 2, shared_tags: [], created_at: 'x' }), null);
});

test('connection profile requires a name and lists and discards legacy quiz answers', () => {
  const p = mapConnectionProfile({
    counterpart_ref: 'x', display_name: 'Riya', bio: 'b', home_area: 'austin', availability: '', up_to: '',
    interests: ['jazz'], answers: [], shared_tags: [],
  });
  assert.equal(p?.displayName, 'Riya');
  assert.deepEqual(p?.answers, []);
  const legacy = mapConnectionProfile({ counterpart_ref: 'x', display_name: 'Riya', bio: '', home_area: '', availability: '', up_to: '', interests: [], answers: ['overwhelmed:paused'], shared_tags: [] });
  assert.deepEqual(legacy?.answers, []);
  assert.equal(mapConnectionProfile({ counterpart_ref: 'x', interests: [], answers: [], shared_tags: [] }), null);
});

test('knownThrough says how far away someone is', () => {
  assert.equal(knownThrough({ viaName: 'Sam', hops: 2 }), 'Someone Sam knows');
  assert.equal(knownThrough({ viaName: 'Sam', hops: 3 }), "Someone a friend of Sam's knows");
});

test('local demo network is fictional, bounded, and offers no actionable request state', () => {
  assert.equal(DEMO_PROFILE.homeArea, 'berkeley');
  assert.equal(DEMO_FOF_CARDS.length, 2);
  assert.ok(DEMO_FOF_CARDS.every((card) => card.candidateRef.startsWith('demo-') && card.requestStatus === 'none' && card.hops >= 2 && card.hops <= 3));
});

test('Claude opener input excludes private profile and journal context', () => {
  const input = openerInputForCard({ viaName: 'Sam', hops: 2, mutualCount: 1, sharedTags: ['climbing'] });
  assert.deepEqual(input, { candidate: { viaName: 'Sam', hops: 2, mutualCount: 1, sharedTags: ['climbing'], area: '' }, sender: { bio: '', upTo: '', availability: '', interests: [], homeArea: '' } });
  assert.deepEqual(input.sender, { bio: '', upTo: '', availability: '', interests: [], homeArea: '' });
});
