// DS-R3 event eligibility and same-event companion checks (offline, synthetic). Runs under `npm run test:app`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { eligibleEvents, rankEventCompanions, type EventInput } from '../events.ts';
import type { NearbyPoolFile } from '../metrics.ts';

const load = async (f: string) => JSON.parse(await readFile(new URL(`../fixtures/${f}`, import.meta.url), 'utf8'));
const feed = await load('event-listings.json');
const pool: NearbyPoolFile = await load('nearby-candidates.json');
const now = new Date(feed.clock);
const card = (ref: string) => structuredClone(pool.candidates.find(c => c.ref === ref)!);
const JAZZ = { eventId: 'evt-jazz', intent: 'going' as const, expiresAt: '2026-10-25T05:00:00Z' };
const GAMES = { eventId: 'evt-games-night', intent: 'interested' as const, expiresAt: '2026-10-25T05:00:00Z' };

const base = (over: Partial<EventInput> = {}): EventInput => ({
  viewer: structuredClone(pool.viewers.v1!), viewerAreaKey: feed.viewerAreaKey, events: structuredClone(feed.events),
  candidates: structuredClone(pool.candidates), allowedTags: pool.allowedTags, now, ...over,
});
const reasonOf = (r: ReturnType<typeof rankEventCompanions>) => (r.kind === 'none' ? r.reason : 'events');

// ---- Eligibility (catalogue only) ----

test('events: only the in-area, scheduled, upcoming, fresh, allowlisted rows are eligible; each other row has its reason', () => {
  const { eligible, excluded } = eligibleEvents(feed.events, feed.viewerAreaKey, pool.allowedTags, now);
  assert.deepEqual(eligible.map(e => e.eventId), ['evt-games-night', 'evt-jazz']);
  for (const [id, reason] of Object.entries(feed.expectedExclusion))
    assert.ok(excluded.some(x => x.eventId === id && x.reason === reason), `${id} → ${reason}`);
  // The surviving games-night copy is the latest fetch (scheduled), not the older cancelled one.
  assert.equal(eligible[0]!.status, 'scheduled');
});

test('events: duplicate resolution is order-independent and a same-fetch cancelled copy wins over scheduled', () => {
  const expected = eligibleEvents(feed.events, feed.viewerAreaKey, pool.allowedTags, now).eligible.map(e => e.eventId);
  for (let k = 1; k < feed.events.length; k++) {
    const rotated = [...feed.events.slice(k), ...feed.events.slice(0, k)];
    assert.deepEqual(eligibleEvents(rotated, feed.viewerAreaKey, pool.allowedTags, now).eligible.map(e => e.eventId), expected, `rotation ${k}`);
  }
  const games = feed.events[0];
  for (const rows of [[games, { ...games, status: 'cancelled' }], [{ ...games, status: 'cancelled' }, games]]) {
    const r = eligibleEvents(rows, feed.viewerAreaKey, pool.allowedTags, now);
    assert.deepEqual(r.eligible, []);
    assert.ok(r.excluded.some(x => x.reason === 'cancelled'));
  }
});

test('events: no active area means no in-person event, even one in the feed', () => {
  assert.deepEqual(eligibleEvents(feed.events, null, pool.allowedTags, now).eligible, []);
});

// ---- Successful matches ----

test('events: games-night companions are the people with a current published intent for it (c-13 expired, c-09 other event)', () => {
  const r = rankEventCompanions(base());
  assert.equal(r.kind, 'events');
  if (r.kind !== 'events') return;
  assert.equal(r.events.length, 1);
  const [games] = r.events;
  assert.equal(games!.eventId, 'evt-games-night');
  assert.equal(games!.viewerIntent, 'interested');
  assert.deepEqual(games!.companions.map(c => c.ref), ['c-01', 'c-03', 'c-14']);
  assert.deepEqual(games!.companions[0]!.reasons, ['shared_interest', 'same_event', 'event_fits_shared_interest']);
  assert.deepEqual(games!.companions.find(c => c.ref === 'c-14')!.reasons, ['same_event']);
  for (const c of games!.companions) assert.equal(c.sharedEventId, 'evt-games-night');
});

test('events: a viewer with intents for two eligible events gets both, soonest first', () => {
  const viewer = { ...pool.viewers.v1!, tags: ['board-games', 'live-music'], eventIntents: [JAZZ, GAMES] };
  const r = rankEventCompanions(base({ viewer }));
  assert.equal(r.kind, 'events');
  if (r.kind !== 'events') return;
  assert.deepEqual(r.events.map(e => e.eventId), ['evt-games-night', 'evt-jazz']);
  assert.deepEqual(r.events[1]!.companions.map(c => c.ref), ['c-09']);
  assert.equal(r.events[1]!.companions[0]!.theirIntent, 'interested');
});

test('events: deterministic under candidate and event order; input is not mutated', () => {
  const expected = rankEventCompanions(base());
  const before = JSON.stringify([pool.candidates, feed.events]);
  for (let k = 1; k < pool.candidates.length; k++) {
    const candidates = structuredClone([...pool.candidates.slice(k), ...pool.candidates.slice(0, k)]);
    const events = structuredClone([...feed.events.slice(k % feed.events.length), ...feed.events.slice(0, k % feed.events.length)]);
    assert.deepEqual(rankEventCompanions(base({ candidates, events })), expected, `rotation ${k}`);
  }
  assert.equal(JSON.stringify([pool.candidates, feed.events]), before);
});

// ---- No-action cases ----

test('no-action: viewer not published', () => {
  assert.equal(reasonOf(rankEventCompanions(base({ viewer: { ...pool.viewers.v1!, published: false } }))), 'not_published');
});

test('no-action: viewer has no active area', () => {
  assert.equal(reasonOf(rankEventCompanions(base({ viewerAreaKey: null }))), 'no_active_area');
});

test('no-action: viewer is in a different area than every event', () => {
  assert.equal(reasonOf(rankEventCompanions(base({ viewerAreaKey: 'area-z' }))), 'no_eligible_event');
});

test('no-action: catalogue has only ineligible events', () => {
  const events = feed.events.filter((e: { eventId: string }) => !['evt-games-night', 'evt-jazz'].includes(e.eventId));
  assert.equal(reasonOf(rankEventCompanions(base({ events }))), 'no_eligible_event');
});

test('no-action: empty catalogue', () => {
  assert.equal(reasonOf(rankEventCompanions(base({ events: [] }))), 'no_eligible_event');
});

// ---- Missing event intent ----

test('missing intent: viewer published tags but no event intent', () => {
  assert.equal(reasonOf(rankEventCompanions(base({ viewer: { ...pool.viewers.v1!, eventIntents: [] } }))), 'viewer_no_event_intent');
});

test('missing intent: viewer intent is for an out-of-area or cancelled event only', () => {
  for (const eventId of ['evt-other-area', 'evt-hike-cancelled', 'evt-unlisted']) {
    const viewer = { ...pool.viewers.v1!, eventIntents: [{ ...GAMES, eventId }] };
    assert.equal(reasonOf(rankEventCompanions(base({ viewer }))), 'viewer_no_event_intent', eventId);
  }
});

test('missing intent: shared tags alone never make an event companion (one-sided intent)', () => {
  // c-05..c-10 have no games-night intent; c-10 shares coffee with the viewer.
  const r = rankEventCompanions(base({ candidates: ['c-02', 'c-04', 'c-10'].map(card) }));
  assert.equal(reasonOf(r), 'no_companions');
});

test('missing intent: both people intend the same out-of-area event, still nothing', () => {
  const other = { ...GAMES, eventId: 'evt-other-area' };
  const viewer = { ...pool.viewers.v1!, eventIntents: [GAMES, other] };
  const c = { ...card('c-10'), eventIntents: [other] };
  assert.equal(reasonOf(rankEventCompanions(base({ viewer, candidates: [c] }))), 'no_companions');
});

// ---- Expired intent ----

test('expired intent: the viewer\'s own expired intent yields nothing', () => {
  const viewer = { ...pool.viewers.v1!, eventIntents: [{ ...GAMES, expiresAt: '2026-10-24T17:59:59Z' }] };
  assert.equal(reasonOf(rankEventCompanions(base({ viewer }))), 'viewer_no_event_intent');
});

test('expired intent: a candidate whose intent expired is not a companion (c-13 only)', () => {
  assert.equal(reasonOf(rankEventCompanions(base({ candidates: [card('c-13')] }))), 'no_companions');
});

test('expired intent: an intent expiring exactly now no longer counts; one second later it does', () => {
  const at = (expiresAt: string) => [{ ...card('c-14'), eventIntents: [{ ...GAMES, expiresAt }] }];
  assert.equal(reasonOf(rankEventCompanions(base({ candidates: at(feed.clock) }))), 'no_companions');
  assert.equal(reasonOf(rankEventCompanions(base({ candidates: at('2026-10-24T18:00:01Z') }))), 'events');
});

// ---- Blocked / already connected / withdrawn / expired publication ----

test('exclusion: blocked, already-connected, withdrawn and expired-publication people never appear, even with the same intent', () => {
  const patched = [
    { ...card('c-05'), eventIntents: [GAMES] }, // blocked
    { ...card('c-08'), eventIntents: [GAMES] }, // already connected
    { ...card('c-06'), eventIntents: [GAMES] }, // withdrawn
    { ...card('c-07'), eventIntents: [GAMES] }, // publication expired
  ];
  assert.equal(reasonOf(rankEventCompanions(base({ candidates: patched }))), 'no_companions');
  const mixed = rankEventCompanions(base({ candidates: [...patched, card('c-14')] }));
  assert.equal(mixed.kind, 'events');
  if (mixed.kind === 'events') assert.deepEqual(mixed.events[0]!.companions.map(c => c.ref), ['c-14']);
  for (const patch of [{ blocked: true }, { alreadyConnected: true }]) {
    const r = rankEventCompanions(base({ candidates: [{ ...card('c-01'), ...patch }] }));
    assert.equal(reasonOf(r), 'no_companions', JSON.stringify(patch));
  }
});

test('exclusion: a card with a malformed intent is rejected, not repaired by filtering', () => {
  const bad = { ...card('c-01'), eventIntents: [GAMES, { eventId: 'evt-x', intent: 'attending', expiresAt: GAMES.expiresAt }] };
  assert.equal(reasonOf(rankEventCompanions(base({ candidates: [bad] }))), 'no_companions');
  const leaky = { ...card('c-01'), attendance: true };
  assert.equal(reasonOf(rankEventCompanions(base({ candidates: [leaky] }))), 'no_companions');
});

// ---- Output boundary ----

test('output: only IDs, intents and reason codes; no names, titles, areas or private fields', () => {
  const r = rankEventCompanions(base());
  const wire = JSON.stringify(r);
  for (const c of pool.candidates) assert.ok(!wire.includes(JSON.stringify((c as { displayName?: string }).displayName)), c.ref);
  assert.ok(!/area-a|Example St|SYNTHETIC|"lat"|distance|startsAt|fetchedAt/.test(wire));
  if (r.kind !== 'events') return assert.fail('expected events');
  for (const e of r.events) {
    assert.deepEqual(Object.keys(e).sort(), ['companions', 'eventId', 'viewerIntent']);
    for (const c of e.companions)
      assert.deepEqual(Object.keys(c).sort(), ['reasons', 'ref', 'sharedEventId', 'sharedTags', 'theirIntent']);
  }
});
