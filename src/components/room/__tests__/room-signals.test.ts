import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_OBJECTS, placeBadges, roomSignals, type RoomSignalInput } from '../room-signals.ts';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const later = '2026-10-25T12:00:00Z';
const earlier = '2026-10-23T12:00:00Z';

const base: RoomSignalInput = { me: null, cards: [], events: [], introductions: [], pairs: [], plans: [], nudges: [], nowMs: NOW };

const me = (over: Partial<NonNullable<RoomSignalInput['me']>> = {}) => ({
  publicationId: 'pub', published: true, displayName: 'Maya', interestTags: [], revision: 1, expiresAt: later,
  withdrawn: false, expired: false, areaKey: 'berkeley-campus', areaExpiresAt: later, areaActive: true, discoveryEnabled: true, ...over,
});
const card = (n: number) => ({ cardRef: `c${n}`, displayName: `P${n}`, interestTags: [], sharedTags: [], revision: 1 });
const intro = (direction: 'incoming' | 'outgoing', status: 'pending' | 'accepted' | 'declined' | 'closed') =>
  ({ introId: `${direction}-${status}`, direction, status, counterpartName: null, sharedTags: [], createdAt: earlier, expiresAt: later });

test('an empty room shows nothing and nothing is published', () => {
  const s = roomSignals(base);
  assert.equal(s.flyers + s.postcards + s.envelopes + s.planes + s.books + s.loosePages, 0);
  assert.equal(s.pinboardPublished, false);
});

test('postcards appear only while your own pinboard is published', () => {
  const cards = [card(1), card(2)];
  assert.equal(roomSignals({ ...base, cards }).postcards, 0);
  assert.equal(roomSignals({ ...base, cards, me: me() }).postcards, 2);
  assert.equal(roomSignals({ ...base, cards, me: me({ withdrawn: true }) }).postcards, 0);
});

test('only pending incoming introductions become envelopes; outgoing never do', () => {
  const s = roomSignals({ ...base, introductions: [intro('incoming', 'pending'), intro('outgoing', 'pending'), intro('incoming', 'declined')] });
  assert.equal(s.envelopes, 1);
});

test('expired nudges and past events leave the room', () => {
  const s = roomSignals({
    ...base,
    nudges: [{ id: 'n1', pairId: 'p', templateId: 'check_in_this_week' as never, visibleUntil: earlier }, { id: 'n2', pairId: 'p', templateId: 'check_in_this_week' as never, visibleUntil: later }],
    events: [
      { eventId: 'e1', title: 'Past', startsAt: earlier, endsAt: earlier, topics: [], format: 'in_person', areaKey: null, sourceUrl: null, fetchedAt: earlier },
      { eventId: 'e2', title: 'Soon', startsAt: later, endsAt: null, topics: [], format: 'in_person', areaKey: null, sourceUrl: null, fetchedAt: earlier },
    ],
  });
  assert.equal(s.planes, 1);
  assert.equal(s.flyers, 1);
});

test('object counts are capped so the room never overflows', () => {
  const cards = Array.from({ length: 20 }, (_, n) => card(n));
  assert.equal(roomSignals({ ...base, cards, me: me() }).postcards, MAX_OBJECTS);
});

test('books, loose pages and city lights follow real connections', () => {
  const pairs = [
    { pairId: 'a', counterpartIdentityHex: 'x', counterpartDisplayName: 'Leo', status: 'accepted' as const, createdAt: earlier },
    { pairId: 'b', counterpartIdentityHex: null, counterpartDisplayName: null, status: 'pending' as const, createdAt: earlier },
  ];
  const s = roomSignals({ ...base, pairs, introductions: [intro('outgoing', 'accepted')] });
  assert.equal(s.books, 1);
  assert.equal(s.pendingBooks, 1);
  assert.equal(s.loosePages, 1);
  assert.equal(s.cityLights, 2);
  assert.deepEqual(placeBadges(s), { window: 0, sill: 0, mat: 0, tray: 0, calendar: 0 });
});
