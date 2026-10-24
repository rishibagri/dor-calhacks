// DS discovery view-model checks (offline, synthetic). Runs under `npm run test:app`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rankNearby } from '../../../evaluation/nearby.ts';
import { rankActivities } from '../../../evaluation/rank.ts';
import type { DiscoveryCandidate, NoShortlistReason } from '../types.ts';
import { DISCOVERY_REPORT_REASONS } from '@dor/contracts';
import { emptyState, eventEmptyState, freshnessLabel, initials, reasonLines, REPORT_NOTICE, REPORT_REASON_LABEL, REPORT_REASONS, tagLabel,
  toCardViews, toEventCardViews } from '../view-model.ts';

const load = async (f: string) => JSON.parse(await readFile(new URL(`../../../evaluation/fixtures/${f}`, import.meta.url), 'utf8'));
const pool = await load('nearby-candidates.json');
const catalogue = await load('activity-catalogue.json');
const now = new Date('2026-10-24T18:00:00Z');
const shortlist = (mode: any = { kind: 'nearby' }) => rankNearby({ viewer: pool.viewers.v1, candidates: structuredClone(pool.candidates),
  mode, allowedTags: pool.allowedTags, now });

test('cards show exactly the published projection: name, avatar, published tags and reasons', () => {
  const views = toCardViews(shortlist(), pool.candidates);
  assert.deepEqual(views.map(v => v.ref), ['c-01', 'c-03', 'c-14']);
  for (const v of views) {
    const row = pool.candidates.find((c: DiscoveryCandidate) => c.ref === v.ref);
    assert.equal(v.displayName, row.displayName);
    assert.deepEqual(v.tags.map(t => t.slug), row.tags);
    assert.deepEqual(Object.keys(v).sort(), ['avatarMediaId', 'displayName', 'initials', 'reasons', 'ref', 'tags']);
  }
  assert.deepEqual(views[0]!.reasons, ['You both picked board games and coffee.',
    'You both marked the same event.']);
});

test('no percentage, distance, presence or attendance wording anywhere a card or empty state can show', () => {
  const reasons: NoShortlistReason[] = ['not_published', 'viewer_has_nothing_published', 'viewer_no_event_intent', 'empty_area', 'no_fit'];
  const text = JSON.stringify([
    toCardViews(shortlist(), pool.candidates, 'Games night'),
    toCardViews(shortlist({ kind: 'event', eventId: 'evt-games-night', eventTags: ['board-games'] }), pool.candidates, 'Games night'),
    ...reasons.flatMap(r => [emptyState(r, 'nearby'), emptyState(r, 'event')]),
  ]);
  assert.doesNotMatch(text, /%|percent|match score|\bmeters?\b|\bkm\b|\bmiles?\b|feet|away|right now nearby|attending|attendee|will attend|confirmed going/i);
});

test('an entry without an authorized row is dropped, not filled in', () => {
  assert.deepEqual(toCardViews(shortlist(), pool.candidates.filter((c: DiscoveryCandidate) => c.ref !== 'c-03')).map(v => v.ref), ['c-01', 'c-14']);
});

test('labels', () => {
  assert.equal(tagLabel('board-games'), 'Board games');
  assert.equal(initials('Sam Rivera Lopez'), 'SR');
  assert.equal(initials('  '), '?');
  assert.deepEqual(reasonLines({ ref: 'x', reasons: ['shared_interest'], sharedTags: ['a', 'b', 'c'], sharedEventId: null }),
    ['You both picked a, b and c.']);
  assert.equal(emptyState('empty_area', 'nearby').action, 'browse_events');
  assert.equal(emptyState('not_published', 'nearby').action, 'publish_profile');
});

test('event cards: freshness and unknowns are stated, never invented', () => {
  const items = structuredClone(catalogue.items);
  const result = rankActivities({ agreed: { supportMode: 'shared_activity', availability: 'this_week' }, catalogue: items,
    approvedInterests: null, now: new Date('2026-10-24T00:00:00Z'), utcOffsetMinutes: -420, allowedSourceSites: catalogue.allowedSourceSites });
  const views = toEventCardViews(result, items, new Date('2026-10-24T00:00:00Z'), -420);
  assert.equal(views[0]!.activityId, 'act-trivia-tonight');
  assert.equal(views[0]!.when, 'Fri, Oct 23, 8:00 PM');
  assert.equal(views[0]!.freshness, 'Listing checked 4 hours ago');
  assert.match(freshnessLabel('2026-10-22T06:00:00Z', 'cached', new Date('2026-10-24T00:00:00Z')), /Saved listing from 42 hours ago; details may have changed/);
  assert.match(eventEmptyState('source_unavailable').body, /Nothing shown here is made up/);
});

test('D039: the same-event line never reveals the other person\'s interested/going and reads the same for either', () => {
  const entry = { ref: 'x', reasons: ['same_event' as const], sharedTags: [], sharedEventId: 'evt-games-night' };
  assert.deepEqual(reasonLines(entry, 'Games night'), ['You both marked Games night.']);
  const text = JSON.stringify([toCardViews(shortlist(), pool.candidates, 'Games night'),
    toCardViews(shortlist({ kind: 'event', eventId: 'evt-games-night', eventTags: ['board-games'] }), pool.candidates, 'Games night')]);
  assert.doesNotMatch(text, /planning to go|\bgoing\b|\binterested\b|they said|will go/i);
});

test('D038: no decline oracle: nothing a card or empty state shows can say a request was declined or ignored', () => {
  const reasons: NoShortlistReason[] = ['not_published', 'viewer_has_nothing_published', 'viewer_no_event_intent', 'empty_area', 'no_fit'];
  const text = JSON.stringify([toCardViews(shortlist(), pool.candidates), ...reasons.flatMap(r => [emptyState(r, 'nearby'), emptyState(r, 'event')])]);
  assert.doesNotMatch(text, /declin|reject|ignored|turned you down|not interested in you/i);
});

test('D038 card report: reasons are exactly the contract allowlist, each with a fixed label; no free-text option', () => {
  assert.deepEqual([...REPORT_REASONS], [...DISCOVERY_REPORT_REASONS]);
  assert.deepEqual(Object.keys(REPORT_REASON_LABEL).sort(), [...DISCOVERY_REPORT_REASONS].sort());
  for (const r of REPORT_REASONS) assert.ok(REPORT_REASON_LABEL[r].length > 0 && REPORT_REASON_LABEL[r].length <= 60, r);
  assert.match(REPORT_NOTICE, /also blocks/);
  assert.match(REPORT_NOTICE, /not told who reported or why/);
});
