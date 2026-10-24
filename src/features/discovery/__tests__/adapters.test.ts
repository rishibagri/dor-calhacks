// C8 discovery_cards → ranker adapter checks (offline, synthetic). Rows are built with Cyber's own
// projectDiscoveryCard so the test tracks the real projection shape. Runs under `npm run test:app`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DISCOVERY_REASON_CODES } from '@kinetic/contracts';
import { projectDiscoveryCard, type PublicationState } from '@kinetic/contracts/policy';
import { fromDiscoveryCard, fromDiscoveryCards, rankDiscoveryCards } from '../adapters.ts';
import { REASON_CODES, type DiscoveryCandidate, type DiscoveryViewer } from '../types.ts';
import { rankNearby } from '../../../evaluation/nearby.ts';
import type { NearbyPoolFile } from '../../../evaluation/metrics.ts';

const pool: NearbyPoolFile & { clock: string } = JSON.parse(await readFile(new URL('../../../evaluation/fixtures/nearby-candidates.json', import.meta.url), 'utf8'));
const now = new Date(pool.clock);
const allowed = new Set(pool.allowedTags);
const viewer: DiscoveryViewer = { ...structuredClone(pool.viewers.v1!), eventIntents: [] };

const pub = (id: string, displayName: string, interestTags: string[], revision = 1): PublicationState => ({
  publicationId: id, ownerId: `owner-${id}`, displayName, interestTags, audience: 'area_discoverers', noticeVersion: 1,
  revision, expiresAtMs: now.getTime() + 3_600_000, withdrawnAtMs: null, expiredMarked: false,
});
const row = (id: string, name: string, tags: string[], revision = 1) => projectDiscoveryCard(pub(id, name, tags, revision), viewer.tags);

// Fixture people the server would actually show: valid shape, not blocked/withdrawn/expired/connected.
const visible = (pool.candidates as unknown as DiscoveryCandidate[]).filter(c =>
  Object.keys(c).length === 10 && !c.blocked && !c.withdrawn && !c.alreadyConnected &&
  c.publicationExpiresAt !== null && Date.parse(c.publicationExpiresAt) > now.getTime() && c.tags.every(t => allowed.has(t)));
const rows = visible.map(c => row(c.ref, c.displayName, c.tags, c.publicationVersion));

test('adapter: reason codes are the shared contract list', () => {
  assert.deepEqual([...REASON_CODES], [...DISCOVERY_REASON_CODES]);
});

test('adapter: a real projection row maps field-for-field, filling only conservative defaults', () => {
  const c = fromDiscoveryCard(row('pub-a', 'Sam', ['coffee', 'board-games'], 3), viewer.tags, allowed);
  assert.deepEqual(c, {
    ref: 'pub-a', displayName: 'Sam', avatarMediaId: null, tags: ['coffee', 'board-games'], eventIntents: [],
    publicationVersion: 3, publicationExpiresAt: null, withdrawn: false, blocked: false, alreadyConnected: false,
  });
});

test('adapter: every visible fixture person survives the projection round-trip', () => {
  assert.ok(rows.length >= 5);
  const r = fromDiscoveryCards(rows, viewer.tags, pool.allowedTags);
  assert.deepEqual(r.rejected, []);
  assert.deepEqual(r.candidates.map(c => c.ref), visible.map(c => c.ref));
});

test('adapter: ranking projection rows equals ranking the same people as DS cards (no intents, server-side expiry)', () => {
  const same = visible.map(c => ({ ...c, eventIntents: [], publicationExpiresAt: null }));
  const direct = rankNearby({ viewer, candidates: same, mode: { kind: 'nearby' }, allowedTags: pool.allowedTags, now });
  const viaRows = rankDiscoveryCards({ viewer, rows, mode: { kind: 'nearby' }, allowedTags: pool.allowedTags, now });
  assert.equal(viaRows.shortlist.kind, 'shortlist');
  assert.deepEqual(viaRows.shortlist, direct);
});

test('adapter: same rows in any order give the same shortlist', () => {
  const base = rankDiscoveryCards({ viewer, rows, mode: { kind: 'nearby' }, allowedTags: pool.allowedTags, now }).shortlist;
  for (const order of [[...rows].reverse(), [...rows.slice(2), ...rows.slice(0, 2)]])
    assert.deepEqual(rankDiscoveryCards({ viewer, rows: order, mode: { kind: 'nearby' }, allowedTags: pool.allowedTags, now }).shortlist, base);
});

const good = () => ({ ...row('pub-x', 'Ana', ['coffee', 'hiking']) }) as Record<string, unknown>;
const bad: [string, Record<string, unknown>, string][] = [
  ['coordinates', { ...good(), lat: 37.87, lon: -122.27 }, 'invalid_card'],
  ['distance', { ...good(), distanceMeters: 120 }, 'invalid_card'],
  ['area key', { ...good(), areaKey: 'berkeley-north' }, 'invalid_card'],
  ['expiry leak', { ...good(), expiresAtMs: 1 }, 'invalid_card'],
  ['support field', { ...good(), supportMode: 'listen' }, 'invalid_card'],
  ['name over 40', { ...good(), displayName: 'x'.repeat(41) }, 'invalid_card'],
  ['email in name', { ...good(), displayName: 'ana@example.com' }, 'invalid_card'],
  ['phone in name', { ...good(), displayName: 'Ana 510 555 0100' }, 'invalid_card'],
  ['bidi override', { ...good(), displayName: 'Ana‮evil' }, 'invalid_card'],
  ['empty name', { ...good(), displayName: '' }, 'invalid_card'],
  ['unallowlisted tag', { ...good(), interestTags: ['coffee', 'therapy'], sharedTags: ['coffee'] }, 'invalid_card'],
  ['nine tags', { ...good(), interestTags: pool.allowedTags.slice(0, 9), sharedTags: [] }, 'invalid_card'],
  ['duplicate tags', { ...good(), interestTags: ['coffee', 'coffee'], sharedTags: ['coffee'] }, 'invalid_card'],
  ['revision 0', { ...good(), revision: 0 }, 'invalid_card'],
  ['missing ref', { ...good(), cardRef: '' }, 'invalid_card'],
  ['overlap the viewer never published', { ...good(), sharedTags: ['coffee', 'hiking'] }, 'shared_tags_mismatch'],
  ['overlap hidden', { ...good(), sharedTags: [] }, 'shared_tags_mismatch'],
];

test('adapter: malformed or leaking rows are rejected, not repaired', () => {
  assert.notEqual(typeof fromDiscoveryCard(good(), viewer.tags, allowed), 'string');
  for (const [label, r, reason] of bad) assert.equal(fromDiscoveryCard(r, viewer.tags, allowed), reason, label);
  for (const r of [null, 'pub-x', [], 42]) assert.equal(fromDiscoveryCard(r, viewer.tags, allowed), 'invalid_card');
});

test('adapter: rejected rows are reported as excluded and never reach the shortlist', () => {
  const leaks = bad.map(([, r], i) => (r.cardRef === '' ? r : { ...r, cardRef: `leak-${i}` }));
  const r = rankDiscoveryCards({ viewer, rows: [...rows, ...leaks], mode: { kind: 'nearby' }, allowedTags: pool.allowedTags, now });
  assert.equal(r.shortlist.kind, 'shortlist');
  if (r.shortlist.kind !== 'shortlist') return;
  assert.ok(r.shortlist.entries.every(e => !e.ref.startsWith('leak-')));
  assert.equal(r.rejected.length, bad.length);
  assert.equal(r.rejected.filter(x => x.ref === null).length, 1); // the empty-ref row
  assert.equal(r.shortlist.excluded.filter(e => e.reason === 'invalid_card').length, bad.length);
  assert.ok(r.candidates.every(c => !c.ref.startsWith('leak-')));
});

test('adapter: an unpublished viewer gets nothing even when rows arrive', () => {
  const r = rankDiscoveryCards({ viewer: { ...viewer, published: false }, rows, mode: { kind: 'nearby' }, allowedTags: pool.allowedTags, now });
  assert.deepEqual([r.shortlist.kind, r.shortlist.kind === 'none' && r.shortlist.reason], ['none', 'not_published']);
});

test('adapter: no overlap is an honest no_fit, an empty page an honest empty_area', () => {
  const far = [row('pub-f1', 'Lee', ['running']), row('pub-f2', 'Kim', ['photography'])];
  const noFit = rankDiscoveryCards({ viewer, rows: far, mode: { kind: 'nearby' }, allowedTags: pool.allowedTags, now }).shortlist;
  assert.deepEqual([noFit.kind, noFit.kind === 'none' && noFit.reason], ['none', 'no_fit']);
  const empty = rankDiscoveryCards({ viewer, rows: [], mode: { kind: 'nearby' }, allowedTags: pool.allowedTags, now }).shortlist;
  assert.deepEqual([empty.kind, empty.kind === 'none' && empty.reason], ['none', 'empty_area']);
});

test('adapter: projection rows never yield a same-event reason (no event-intent producer yet)', () => {
  const r = rankDiscoveryCards({ viewer, rows, mode: { kind: 'nearby' }, allowedTags: pool.allowedTags, now }).shortlist;
  assert.ok(r.kind === 'shortlist' && r.entries.every(e => e.sharedEventId === null && !e.reasons.includes('same_event')));
});

test('adapter: more than the card limit is truncated, not ranked', () => {
  const many = Array.from({ length: 60 }, (_, i) => row(`pub-${String(i).padStart(3, '0')}`, `P${i}`, ['coffee']));
  const r = rankDiscoveryCards({ viewer, rows: many, mode: { kind: 'nearby' }, allowedTags: pool.allowedTags, now }).shortlist;
  assert.ok(r.truncated);
  assert.equal(r.excluded.filter(e => e.reason === 'over_cap').length, 10);
});
