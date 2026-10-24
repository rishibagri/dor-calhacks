// DS-R3 event companions over the D039 server projections, plus D038/D039 privacy and no-action regressions
// (offline, synthetic). Runs under `npm run test:app`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CATALOGUE_MAX_SOURCE_AGE_MS, guardAreaKey } from '@dor/contracts/policy';
import { eligibleEvents, rankEventCompanions, validAreaKey, type EventCompanionInput } from '../events.ts';
import { rankNearby } from '../nearby.ts';
import { forIntroductionProposals, MAX_PROPOSAL_TAGS } from '../../features/discovery/adapters.ts';
import { toCardViews } from '../../features/discovery/view-model.ts';
import type { DiscoveryCandidate } from '../../features/discovery/types.ts';

const fx = JSON.parse(await readFile(new URL('../fixtures/event-listings.json', import.meta.url), 'utf8'));
const now = new Date(fx.clock);
const games = () => structuredClone(fx.catalogue[0]);
const base = (over: Partial<EventCompanionInput> = {}): EventCompanionInput => ({
  viewer: structuredClone(fx.viewer), viewerAreaKey: fx.viewerAreaKey, catalogue: structuredClone(fx.catalogue),
  myIntents: structuredClone(fx.myIntents), cards: structuredClone(fx.cards), companions: structuredClone(fx.companions),
  allowedTags: fx.allowedTags, now, ...over,
});
const run = (over: Partial<EventCompanionInput> = {}) => rankEventCompanions(base(over));
const reasonOf = (r: ReturnType<typeof rankEventCompanions>) => (r.kind === 'none' ? r.reason : 'events');
const refsFor = (r: ReturnType<typeof rankEventCompanions>, eventId: string) =>
  r.kind === 'events' ? r.events.find(e => e.eventId === eventId)?.companions.map(c => c.ref) ?? [] : [];
const JAZZ_ON = { eventId: 'evt-jazz', kind: 'going', version: 4, active: true, expiresAt: '2026-10-24T23:30:00Z' };

// ---- Catalogue eligibility (public data only) ----

test('events: only in-area, upcoming, fresh, allowlisted view rows are eligible; every other row has its reason', () => {
  const { eligible, excluded } = eligibleEvents(fx.catalogue, fx.viewerAreaKey, fx.allowedTags, now);
  assert.deepEqual(eligible.map(e => e.eventId), ['evt-games-night', 'evt-jazz']);
  for (const [id, reason] of Object.entries(fx.expectedExclusion))
    assert.ok(excluded.some(x => x.eventId === id && x.reason === reason), `${id} → ${reason}`);
});

test('events: freshness matches the server\'s 48 h intent rule, not the old 72 h', () => {
  const at = (ageMs: number) => eligibleEvents([{ ...games(), fetchedAt: new Date(now.getTime() - ageMs).toISOString() }],
    fx.viewerAreaKey, fx.allowedTags, now).eligible.length;
  assert.equal(CATALOGUE_MAX_SOURCE_AGE_MS, 48 * 3_600_000);
  assert.equal(at(CATALOGUE_MAX_SOURCE_AGE_MS), 1);
  assert.equal(at(CATALOGUE_MAX_SOURCE_AGE_MS + 1000), 0);
  assert.equal(at(50 * 3_600_000), 0);
});

test('events: area keys follow Cyber\'s coarse-area rule exactly; a precise or malformed key never matches', () => {
  for (const k of ['area-a', 'campus-north', 'ab', 'Area-A', '1area', 'lat:37.77,-122.41', 'area_a', 'a'.repeat(65), 'u4pruydqqvj', ''])
    assert.equal(validAreaKey(k), guardAreaKey(k, [k]).ok, k);
  for (const k of [null, 'lat:37.77,-122.41', 'Area-A'])
    assert.deepEqual(eligibleEvents(fx.catalogue, k, fx.allowedTags, now).eligible, [], String(k));
});

test('events: a duplicated event ID withholds every copy, whatever the order', () => {
  const dups = fx.catalogue.filter((e: { eventId: string }) => e.eventId === 'evt-dup');
  for (const rows of [dups, [...dups].reverse()]) {
    const r = eligibleEvents(rows, fx.viewerAreaKey, fx.allowedTags, now);
    assert.deepEqual(r.eligible, []);
    assert.deepEqual(r.excluded, [{ eventId: 'evt-dup', reason: 'duplicate' }, { eventId: 'evt-dup', reason: 'duplicate' }]);
  }
});

test('events: CS listing shape (events-model.ts toListing) is accepted: status scheduled, endsAt omitted, no title/url', () => {
  // Mirrors src/components/feature/events-model.ts `toListing` exactly; a mismatch here once emptied the Events page.
  const toListing = (e: any) => ({ eventId: e.eventId, startsAt: e.startsAt, ...(e.endsAt ? { endsAt: e.endsAt } : {}),
    status: 'scheduled' as const, fetchedAt: e.fetchedAt, topics: e.topics, format: e.format, areaKey: e.areaKey });
  const rows = fx.catalogue.filter((e: { status?: string; venue?: string }) => e.status === undefined && e.venue === undefined);
  const viaView = eligibleEvents(rows, fx.viewerAreaKey, fx.allowedTags, now).eligible.map(e => e.eventId);
  const viaListing = eligibleEvents(rows.map(toListing), fx.viewerAreaKey, fx.allowedTags, now).eligible.map(e => e.eventId);
  assert.deepEqual(viaListing, ['evt-games-night', 'evt-jazz']);
  assert.deepEqual(viaListing, viaView);
  const tooSoon = toListing(fx.catalogue.find((e: { eventId: string }) => e.eventId === 'evt-too-soon'));
  assert.ok(!('endsAt' in tooSoon));
  assert.deepEqual(eligibleEvents([tooSoon], fx.viewerAreaKey, fx.allowedTags, now).excluded, [{ eventId: 'evt-too-soon', reason: 'starts_too_soon' }]);
  // Normalized output is the view shape, never the caller's object.
  const [g] = eligibleEvents([toListing(games())], fx.viewerAreaKey, fx.allowedTags, now).eligible;
  assert.deepEqual(Object.keys(g!).sort(), ['areaKey', 'endsAt', 'eventId', 'fetchedAt', 'format', 'sourceUrl', 'startsAt', 'title', 'topics']);
});

test('events: any status other than scheduled, or an unknown key, still rejects the row', () => {
  for (const extra of [{ status: 'cancelled' }, { status: 'unknown' }, { status: 'SCHEDULED' }, { venue: 'x' }, { attendees: [] }, { endsAt: undefined, kind: 'going' }])
    assert.deepEqual(eligibleEvents([{ ...games(), ...extra }], fx.viewerAreaKey, fx.allowedTags, now).eligible, [], JSON.stringify(extra));
});

// ---- Successful matches ----

test('success: games-night companions are exactly the visible people the server paired with the viewer', () => {
  const r = run();
  assert.equal(r.kind, 'events');
  if (r.kind !== 'events') return;
  assert.deepEqual(r.events.map(e => e.eventId), ['evt-games-night']);
  const [g] = r.events;
  assert.equal(g!.viewerIntent, 'interested');
  assert.deepEqual(g!.companions.map(c => c.ref), fx.expectedCompanions['evt-games-night']);
  assert.deepEqual(g!.companions[0]!.reasons, ['shared_interest', 'same_event', 'event_fits_shared_interest']);
  assert.deepEqual(g!.companions.find(c => c.ref === 'pub-lee')!.reasons, ['same_event']);
  for (const c of g!.companions) assert.equal(c.sharedEventId, 'evt-games-night');
  assert.deepEqual(r.withheld, fx.expectedWithheld);
});

test('success: with the viewer\'s own jazz intent active, both events come back soonest first', () => {
  const myIntents = [fx.myIntents[0], JAZZ_ON];
  const r = run({ myIntents });
  assert.equal(r.kind, 'events');
  if (r.kind !== 'events') return;
  assert.deepEqual(r.events.map(e => e.eventId), ['evt-games-night', 'evt-jazz']);
  assert.deepEqual(refsFor(r, 'evt-jazz'), ['pub-kai']);
  assert.equal(r.events[1]!.viewerIntent, 'going');
});

test('success: deterministic under the order of every input; inputs are not mutated', () => {
  const expected = run();
  const before = JSON.stringify(fx);
  const rot = <T>(a: T[], k: number) => [...a.slice(k % a.length), ...a.slice(0, k % a.length)];
  for (let k = 1; k < 7; k++)
    assert.deepEqual(run({ catalogue: rot(structuredClone(fx.catalogue), k), myIntents: rot(structuredClone(fx.myIntents), k),
      cards: rot(structuredClone(fx.cards), k), companions: rot(structuredClone(fx.companions), k) }), expected, `rotation ${k}`);
  assert.equal(JSON.stringify(fx), before);
});

// ---- D039 privacy: another person's kind is never disclosed; companions only from the server ----

test('D039: no output field or rendered line carries another person\'s interested/going', () => {
  const r = run({ myIntents: [fx.myIntents[0], JAZZ_ON] });
  if (r.kind !== 'events') return assert.fail('expected events');
  for (const e of r.events) {
    assert.deepEqual(Object.keys(e).sort(), ['companions', 'eventId', 'viewerIntent']);
    for (const c of e.companions) assert.deepEqual(Object.keys(c).sort(), ['reasons', 'ref', 'sharedEventId', 'sharedTags']);
  }
  for (const c of r.candidates) assert.ok(!('eventIntents' in c), c.ref);
  // The only intent kinds in the output are the viewer's own (one per event).
  const kinds = JSON.stringify(r).match(/"(interested|going)"/g) ?? [];
  assert.deepEqual(kinds.sort(), ['"going"', '"interested"']);
  const shortlist = { kind: 'shortlist' as const, mode: 'event' as const, excluded: [], truncated: false, entries: r.events[0]!.companions };
  assert.doesNotMatch(JSON.stringify(toCardViews(shortlist, r.candidates, 'Games night')), /planning to go|\bgoing\b|\binterested\b|they said/i);
});

test('D039: a companion row that carries a kind (or any extra field) is withheld, never used', () => {
  const companions = fx.companions.map((c: object) => ({ ...c, kind: 'going' }));
  const r = run({ companions });
  assert.equal(reasonOf(r), 'no_companions');
  assert.ok(r.withheld.length === companions.length && r.withheld.every(w => w.reason === 'invalid_companion'));
});

test('D039: mutual only: shared tags without a companion row never make an event companion', () => {
  const r = run({ companions: [] });
  assert.equal(reasonOf(r), 'no_companions');
  assert.ok(!refsFor(run(), 'evt-games-night').includes('pub-rio'));
});

test('D039: a companion row whose card is not visible now is withheld (blocked/withdrawn/expired/out of area)', () => {
  const r = run({ cards: fx.cards.filter((c: { cardRef: string }) => c.cardRef !== 'pub-sam') });
  assert.deepEqual(refsFor(r, 'evt-games-night'), ['pub-ana', 'pub-lee']);
  assert.ok(r.withheld.some(w => w.cardRef === 'pub-sam' && w.eventId === 'evt-games-night' && w.reason === 'card_not_visible'));
});

test('D039: a card the strict adapter rejects (leaked area key or kind) cannot be paired either', () => {
  const cards = fx.cards.map((c: { cardRef: string }) => (c.cardRef === 'pub-ana' ? { ...c, areaKey: 'area-a' }
    : c.cardRef === 'pub-sam' ? { ...c, kind: 'going' } : c));
  const r = run({ cards });
  assert.deepEqual(refsFor(r, 'evt-games-night'), ['pub-lee']);
  for (const ref of ['pub-ana', 'pub-sam'])
    assert.ok(r.withheld.some(w => w.cardRef === ref && w.reason === 'card_not_visible'), ref);
});

test('D039: a companion row for an event the viewer does not currently intend here is withheld', () => {
  assert.ok(run().withheld.some(w => w.cardRef === 'pub-kai' && w.reason === 'not_mutual_here')); // revoked jazz intent
  assert.ok(run().withheld.some(w => w.eventId === 'evt-other-area' && w.reason === 'not_mutual_here')); // out of area
});

test('D039: catalogue titles are display data only; injection text never reaches the output', () => {
  const text = JSON.stringify(run({ myIntents: [fx.myIntents[0], JAZZ_ON] }));
  assert.doesNotMatch(text, /Ignore previous|attendee|SYNTHETIC|events\.example\.org|area-a|lat:/);
});

test('D039: blocked or already-connected people are excluded even if a shared event reaches the ranker', () => {
  const card: DiscoveryCandidate = { ref: 'pub-x', displayName: 'X', avatarMediaId: null, tags: ['board-games'],
    sharedEventIds: ['evt-games-night'], publicationVersion: 1, publicationExpiresAt: null, withdrawn: false, blocked: false, alreadyConnected: false };
  const viewer = { ...fx.viewer, eventIntents: [{ eventId: 'evt-games-night', intent: 'interested' as const, expiresAt: '2026-10-24T23:00:00Z' }] };
  const mode = { kind: 'event' as const, eventId: 'evt-games-night', eventTags: ['board-games'] };
  assert.equal(rankNearby({ viewer, candidates: [card], mode, allowedTags: fx.allowedTags, now }).kind, 'shortlist');
  for (const patch of [{ blocked: true }, { alreadyConnected: true }, { withdrawn: true }, { publicationExpiresAt: fx.clock }]) {
    const r = rankNearby({ viewer, candidates: [{ ...card, ...patch }], mode, allowedTags: fx.allowedTags, now });
    assert.equal(r.kind, 'none', JSON.stringify(patch));
  }
});

// ---- No-action: suggestions withheld ----

test('no-action: viewer not published', () => {
  assert.equal(reasonOf(run({ viewer: { ...fx.viewer, published: false } })), 'not_published');
});

test('no-action: no active area, or a malformed/precise area key', () => {
  for (const k of [null, 'lat:37.77,-122.41', 'Area-A']) assert.equal(reasonOf(run({ viewerAreaKey: k })), 'no_active_area', String(k));
});

test('no-action: viewer in another configured area, or an empty or all-ineligible catalogue', () => {
  assert.equal(reasonOf(run({ viewerAreaKey: 'area-z' })), 'no_eligible_event');
  assert.equal(reasonOf(run({ catalogue: [] })), 'no_eligible_event');
  const bad = fx.catalogue.filter((e: { eventId: string }) => !['evt-games-night', 'evt-jazz'].includes(e.eventId));
  assert.equal(reasonOf(run({ catalogue: bad })), 'no_eligible_event');
});

test('missing intent: no own intent, or only for an ineligible event', () => {
  assert.equal(reasonOf(run({ myIntents: [] })), 'viewer_no_event_intent');
  assert.equal(reasonOf(run({ myIntents: [fx.myIntents[1]] })), 'viewer_no_event_intent'); // out-of-area event
});

test('expired or revoked own intent yields nothing; expiry exactly now does not count', () => {
  const g = fx.myIntents[0];
  for (const row of [{ ...g, active: false }, { ...g, expiresAt: fx.clock }, { ...g, expiresAt: '2026-10-24T17:00:00Z' }])
    assert.equal(reasonOf(run({ myIntents: [row] })), 'viewer_no_event_intent', JSON.stringify(row));
  assert.equal(reasonOf(run({ myIntents: [{ ...g, expiresAt: '2026-10-24T18:00:01Z' }] })), 'events');
});

test('malformed own intent rows fail closed (extra key, unknown kind, bad version, duplicate)', () => {
  const g = fx.myIntents[0];
  for (const rows of [[{ ...g, attendance: true }], [{ ...g, kind: 'attending' }], [{ ...g, version: 0 }], [g, { ...g, version: 3 }]])
    assert.equal(reasonOf(run({ myIntents: rows })), 'viewer_no_event_intent', JSON.stringify(rows));
});

test('no-action: viewer intends the event but the server returned no companion', () => {
  assert.equal(reasonOf(run({ companions: [] })), 'no_companions');
});

// ---- D038: introduction proposals the server would refuse are withheld ----

test('D038: same_event-only entries are withheld from AI proposals; ready ones are shared_interest with ≤3 tags', () => {
  const r = run();
  if (r.kind !== 'events') return assert.fail('expected events');
  const { ready, withheld } = forIntroductionProposals(r.events[0]!.companions);
  assert.deepEqual(withheld, ['pub-lee']);
  assert.deepEqual(ready.map(e => e.ref), ['pub-ana', 'pub-sam']);
  for (const e of ready) {
    assert.deepEqual(e.reasons, ['shared_interest']);
    assert.equal(e.sharedEventId, null);
    assert.ok(e.sharedTags.length >= 1 && e.sharedTags.length <= MAX_PROPOSAL_TAGS);
  }
  const four = forIntroductionProposals([{ ref: 'p', reasons: ['shared_interest'], sharedTags: ['a-a', 'b-b', 'c-c', 'd-d'], sharedEventId: null }]);
  assert.deepEqual(four.ready[0]!.sharedTags, ['a-a', 'b-b', 'c-c']);
  assert.deepEqual(forIntroductionProposals([]), { ready: [], withheld: [] });
  // A forged entry claiming tags without the shared_interest reason is withheld too.
  assert.deepEqual(forIntroductionProposals([{ ref: 'f', reasons: ['same_event'], sharedTags: ['coffee'], sharedEventId: 'evt-games-night' }]),
    { ready: [], withheld: ['f'] });
});
