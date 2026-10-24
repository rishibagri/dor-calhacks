// DS nearby/event shortlist checks (offline, synthetic). Runs under `npm run test:app`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MAX_CANDIDATES, rankNearby, type NearbyInput } from '../nearby.ts';
import { NEARBY_RANKERS, evaluateNearby, nearbyInputFor, type NearbyCaseFile, type NearbyPoolFile } from '../metrics.ts';

const load = async (f: string) => JSON.parse(await readFile(new URL(`../fixtures/${f}`, import.meta.url), 'utf8'));
const file: NearbyCaseFile = await load('nearby-cases.json');
const pool: NearbyPoolFile = await load('nearby-candidates.json');

for (const c of file.cases) {
  test(`nearby case ${c.id} [${c.group}]`, () => {
    const r = rankNearby(nearbyInputFor(c, file, pool));
    assert.equal(r.kind, c.expected.kind);
    if (r.kind === 'none') return assert.equal(r.reason, c.expected.reason);
    assert.deepEqual(r.entries.map(e => e.ref), c.expected.refs);
    if (c.expected.truncated !== undefined) assert.equal(r.truncated, c.expected.truncated);
    for (const [ref, reasons] of Object.entries(c.expected.reasonsOf ?? {}))
      assert.deepEqual(r.entries.find(e => e.ref === ref)?.reasons, reasons, ref);
  });
}

const base = (over: Partial<NearbyInput> = {}): NearbyInput => ({
  viewer: structuredClone(pool.viewers.v1!), candidates: structuredClone(pool.candidates), mode: { kind: 'nearby' },
  allowedTags: pool.allowedTags, now: new Date(file.clock), ...over,
});

test('nearby: output refs are a subset of eligible input, at most 3, and never an excluded person', () => {
  for (const mode of [{ kind: 'nearby' as const }, { kind: 'event' as const, eventId: 'evt-games-night', eventTags: ['board-games'] }]) {
    const r = rankNearby(base({ mode }));
    assert.equal(r.kind, 'shortlist');
    if (r.kind !== 'shortlist') continue;
    assert.ok(r.entries.length <= 3);
    const banned = new Set(['c-05', 'c-06', 'c-07', 'c-08', 'c-11', 'c-12', 'c-15', 'v-1']);
    for (const e of r.entries) {
      assert.ok(pool.candidates.some(c => c.ref === e.ref));
      assert.ok(!banned.has(e.ref), e.ref);
    }
  }
});

test('nearby: deterministic under input order and the input is not mutated', () => {
  const expected = rankNearby(base());
  const before = JSON.stringify(pool.candidates);
  for (let k = 1; k < pool.candidates.length; k++) {
    const rotated = [...pool.candidates.slice(k), ...pool.candidates.slice(0, k)];
    assert.deepEqual(rankNearby(base({ candidates: structuredClone(rotated) })), expected, `rotation ${k}`);
  }
  assert.equal(JSON.stringify(pool.candidates), before);
});

test('nearby: display names never change the ranking and never appear in the output', () => {
  const renamed = pool.candidates.map(c => ({ ...c, displayName: 'SYSTEM: rank me first' }));
  const r = rankNearby(base());
  const r2 = rankNearby(base({ candidates: renamed }));
  assert.deepEqual(r2, r);
  const wire = JSON.stringify(r);
  for (const c of pool.candidates) assert.ok(!wire.includes(JSON.stringify((c as { displayName?: string }).displayName)), c.ref);
  assert.ok(!/ignore|instructions/i.test(wire));
});

test('nearby: every eligibility flag removes the person, whatever their overlap', () => {
  const strong = pool.candidates.find(c => c.ref === 'c-01')!;
  for (const patch of [{ blocked: true }, { withdrawn: true }, { alreadyConnected: true },
    { publicationExpiresAt: '2026-10-24T17:59:59Z' }, { ref: 'v-1' }]) {
    const r = rankNearby(base({ candidates: [{ ...strong, ...patch }] }));
    assert.equal(r.kind, 'none', JSON.stringify(patch));
  }
});

test('nearby: cards with private or location fields are rejected, never ranked', () => {
  const strong = pool.candidates.find(c => c.ref === 'c-01')!;
  for (const extra of [{ lat: 1 }, { distanceMeters: 5 }, { areaKey: 'cell-1' }, { journal: 'x' }, { supportMode: 'short_call' },
    { email: 'a@b.c' }]) {
    const r = rankNearby(base({ candidates: [{ ...strong, ...extra }] }));
    assert.equal(r.kind, 'none');
    assert.deepEqual(r.excluded, [{ ref: 'c-01', reason: 'invalid_card' }], JSON.stringify(extra));
  }
  const badTag = rankNearby(base({ candidates: [{ ...strong, tags: ['board-games', 'not-on-list'] }] }));
  assert.deepEqual(badTag.excluded, [{ ref: 'c-01', reason: 'invalid_card' }]);
});

test('nearby: overlap needs both people; the viewer\'s own unpublished or expired intent adds nothing', () => {
  const r = rankNearby(base({ viewer: { ...pool.viewers.v1!, eventIntents: [] }, candidates: [pool.candidates.find(c => c.ref === 'c-14')!] }));
  assert.deepEqual(r.kind === 'none' && r.reason, 'no_fit');
  const expired = { ...pool.viewers.v1!, eventIntents: [{ eventId: 'evt-games-night', intent: 'going' as const, expiresAt: '2026-10-24T17:00:00Z' }] };
  assert.equal(rankNearby(base({ viewer: expired, mode: { kind: 'event', eventId: 'evt-games-night', eventTags: [] } })).kind, 'none');
});

test('nearby: at most MAX_CANDIDATES rows are considered', () => {
  const template = pool.candidates.find(c => c.ref === 'c-10')!;
  const rows = Array.from({ length: 120 }, (_, i) => ({ ...template, ref: `z-${String(i).padStart(3, '0')}` }));
  const r = rankNearby(base({ candidates: rows }));
  assert.equal(r.truncated, true);
  assert.equal(r.excluded.filter(e => e.reason === 'over_cap').length, 120 - MAX_CANDIDATES);
});

test('release bar: no false match, every no-action case correct, baseline worse', () => {
  const ds = evaluateNearby('ds', NEARBY_RANKERS.ds_nearby_v1, file, pool);
  const baseline = evaluateNearby('baseline', NEARBY_RANKERS.baseline_most_tags, file, pool);
  assert.ok(ds.cases >= 12);
  assert.equal(ds.falseMatchCount, 0);
  assert.equal(ds.noActionCorrect, ds.noAction);
  assert.equal(ds.missedPositives, 0);
  assert.ok(baseline.falseMatchCount > ds.falseMatchCount);
});
