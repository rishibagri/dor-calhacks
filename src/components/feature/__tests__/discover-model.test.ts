import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCOVERY_CARD_LIMIT, PUBLICATION_MAX_LIFETIME_MS, validClientRequestId } from '@dor/contracts/policy';
import { messageForError } from '../../../features/privacy/introduction-model.ts';
import { orThrow, reportCard } from '../introduction-actions.ts';
import {
  PUBLICATION_DAYS, checkProfileDraft, discoverStage, newIntroductionRequestId, nextPageCursor, publicationExpiry, shortlistFor,
} from '../discover-model.ts';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const me = (over: Record<string, unknown> = {}) => ({
  publicationId: 'pub-me', published: true, displayName: 'Ana', interestTags: ['hiking', 'coffee'], revision: 2,
  expiresAt: '2026-10-26T00:00:00Z', withdrawn: false, expired: false, areaKey: 'berkeley-campus',
  areaExpiresAt: '2026-10-25T00:00:00Z', areaActive: true, discoveryEnabled: true, ...over,
});
const card = (ref: string, tags: string[], shared: string[]) => ({ cardRef: ref, displayName: `P ${ref}`, interestTags: tags, sharedTags: shared, revision: 1 });

test('every publication length stays under the server cap', () => {
  for (const d of PUBLICATION_DAYS) {
    const ms = Date.parse(publicationExpiry(NOW, d)) - NOW;
    assert.ok(ms > 0 && ms < PUBLICATION_MAX_LIFETIME_MS, `${d}`);
  }
});

test('profile draft runs the module guard: contact-like names and unknown tags are refused', () => {
  const exp = publicationExpiry(NOW, 3);
  assert.equal(checkProfileDraft({ displayName: 'Ana', interestTags: ['hiking'] }, exp, NOW).ok, true);
  assert.equal(checkProfileDraft({ displayName: 'Ana', interestTags: [] }, exp, NOW).ok, false);
  assert.equal(checkProfileDraft({ displayName: 'ana@example.com', interestTags: ['hiking'] }, exp, NOW).ok, false);
  assert.equal(checkProfileDraft({ displayName: 'Ana', interestTags: ['skydiving'] }, exp, NOW).ok, false);
  assert.equal(checkProfileDraft({ displayName: '', interestTags: ['hiking'] }, exp, NOW).ok, false);
});

test('stage: disabled, needs profile (withdrawn/expired), needs area (expired/unknown key), ready', () => {
  assert.equal(discoverStage(null, NOW), 'disabled');
  assert.equal(discoverStage(me({ discoveryEnabled: false }) as never, NOW), 'disabled');
  assert.equal(discoverStage(me({ published: false, publicationId: null }) as never, NOW), 'needs_profile');
  assert.equal(discoverStage(me({ withdrawn: true }) as never, NOW), 'needs_profile');
  assert.equal(discoverStage(me({ expiresAt: '2026-10-24T11:00:00Z' }) as never, NOW), 'needs_profile');
  assert.equal(discoverStage(me({ areaActive: false }) as never, NOW), 'needs_area');
  assert.equal(discoverStage(me({ areaKey: 'somewhere-else' }) as never, NOW), 'needs_area');
  assert.equal(discoverStage(me({ areaExpiresAt: '2026-10-24T11:00:00Z' }) as never, NOW), 'needs_area');
  assert.equal(discoverStage(me() as never, NOW), 'ready');
});

test('shortlist: at most 3, only overlapping people, malformed rows rejected not ranked', () => {
  const rows = [
    card('c1', ['hiking', 'film'], ['hiking']),
    card('c2', ['coffee', 'hiking'], ['coffee', 'hiking']),
    card('c3', ['books'], []),
    card('c4', ['coffee'], ['coffee']),
    card('c5', ['hiking'], ['hiking']),
    { ...card('bad', ['hiking'], ['hiking']), areaKey: 'berkeley-campus' },
    card('lie', ['hiking'], ['coffee']),
  ];
  const { shortlist, rejected } = shortlistFor(me() as never, rows, new Date(NOW));
  assert.equal(shortlist.kind, 'shortlist');
  if (shortlist.kind === 'shortlist') {
    assert.ok(shortlist.entries.length <= 3);
    assert.equal(shortlist.entries[0].ref, 'c2');
    assert.ok(!shortlist.entries.some((e) => ['c3', 'bad', 'lie'].includes(e.ref)));
  }
  assert.deepEqual(rejected.map((r) => r.ref).sort(), ['bad', 'lie']);
});

test('no profile yields no shortlist, never a guess', () => {
  const { shortlist } = shortlistFor(me({ published: false, publicationId: null }) as never, [card('c1', ['hiking'], ['hiking'])], new Date(NOW));
  assert.equal(shortlist.kind, 'none');
});

test('request IDs pass the module validator and are fresh per call', () => {
  const ids = new Set(Array.from({ length: 20 }, newIntroductionRequestId));
  assert.equal(ids.size, 20);
  for (const id of ids) assert.equal(validClientRequestId(id), true);
});

test('refusals reach the user only as Cyber fixed copy, never server text or a decline', async () => {
  const fail = (code: string, message: string) => orThrow(Promise.resolve({ ok: false as const, code: code as never, message }));
  const msg = async (p: Promise<void>) => p.then(() => null, messageForError);
  assert.equal(await msg(fail('invalid', 'already_requested')), 'You have already asked this person recently.');
  assert.equal(await msg(fail('not_found', 'card')), 'This is no longer available.');
  const leaked = await msg(fail('invalid', 'declined by recipient <script>'));
  assert.doesNotMatch(String(leaked), /declin|script/i);
  assert.equal(await msg(orThrow(Promise.resolve({ ok: true as const }))), null);
});

test('paging: a short page has no next cursor; a full page continues after its highest ref', () => {
  assert.equal(nextPageCursor([card('b', ['hiking'], ['hiking'])]), null);
  const full = Array.from({ length: DISCOVERY_CARD_LIMIT }, (_, i) => card(`r-${String(i).padStart(3, '0')}`, ['hiking'], ['hiking']));
  assert.equal(nextPageCursor([...full].reverse()), `r-${String(DISCOVERY_CARD_LIMIT - 1).padStart(3, '0')}`);
});

test('card report sends a card target with a fixed reason and surfaces only fixed copy', async () => {
  const calls: unknown[] = [];
  const shared = { reportDiscoveryUser: async (t: unknown, r: unknown) => { calls.push([t, r]); return { ok: false as const, code: 'rate_limited' as const, message: 'rate_limited' }; } };
  const err = await reportCard(shared as never, 'card-1', 'spam').then(() => null, messageForError);
  assert.deepEqual(calls, [[{ kind: 'card', ref: 'card-1' }, 'spam']]);
  assert.match(String(err), /limit/);
});
