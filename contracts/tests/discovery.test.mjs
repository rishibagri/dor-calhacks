// Proposed C8 discovery guards (Cyber, D035). Offline, synthetic names/tags only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guardPublicationDraft, guardAreaKey, guardDiscoveryVisibility, projectDiscoveryCard, discoveryErrorCode,
  validSlugAllowlist, DISCOVERY_NOTICE_VERSION, PUBLICATION_MAX_LIFETIME_MS, AREA_MAX_LIFETIME_MS,
} from '../dist/index.js';
import * as zodFree from '../dist/policy.js';

const NOW = Date.parse('2026-10-24T00:00:00Z');
const TAGS = ['board-games', 'hiking', 'live-music', 'cooking'];
const AREAS = ['berkeley-campus', 'oakland-downtown'];
const draft = (over = {}) => ({ displayName: 'Sam', interestTags: ['board-games'], audience: 'area_discoverers',
  noticeVersion: DISCOVERY_NOTICE_VERSION, expiresAtMs: NOW + 24 * 3600e3, ...over });

const pub = (id, over = {}) => ({ publicationId: `card-${id}`, ownerId: id, displayName: id, interestTags: ['board-games'],
  audience: 'area_discoverers', noticeVersion: DISCOVERY_NOTICE_VERSION, revision: 1, expiresAtMs: NOW + 3600e3,
  withdrawnAtMs: null, expiredMarked: false, ...over });
const area = (id, over = {}) => ({ ownerId: id, areaKey: 'berkeley-campus', expiresAtMs: NOW + 3600e3, active: true, expiredMarked: false, ...over });
const party = (id, p = {}, a = {}) => ({ id, publication: p === null ? null : pub(id, p), area: a === null ? null : area(id, a) });
const vis = (v, t, blocked = false, enabled = true, now = NOW) => guardDiscoveryVisibility(v, t, blocked, enabled, now);

test('zod-free policy entry point exposes the discovery guards for the module', () => {
  assert.equal(zodFree.guardDiscoveryVisibility, guardDiscoveryVisibility);
});

test('publication: exact allowlisted preview is accepted and normalised; result is a fresh object', () => {
  const input = draft({ displayName: '  Sam   R ' });
  const d = guardPublicationDraft(input, TAGS, NOW);
  assert.equal(d.ok, true);
  assert.equal(d.draft.displayName, 'Sam R');
  assert.notEqual(d.draft.interestTags, input.interestTags);
});

test('publication: unknown fields (bio, avatar URL, location, contact) are rejected, never stripped', () => {
  for (const extra of [{ bio: 'hi' }, { avatarUrl: 'https://x.test/a.png' }, { lat: 37.87 }, { areaKey: 'berkeley-campus' }, { phone: '5551234567' }]) {
    assert.equal(guardPublicationDraft(draft(extra), TAGS, NOW).reason, 'invalid_schema');
  }
});

test('publication: names carrying contact details or identifiers are refused', () => {
  for (const displayName of ['sam@example.com', 'call 555 123 4567', 'insta @sam.r', 'sam.example.com', 'https://sam.dev',
    'c0ffee00c0ffee00c0ffee00c0ffee00']) {
    assert.equal(guardPublicationDraft(draft({ displayName }), TAGS, NOW).reason, 'looks_like_identifier', displayName);
  }
  assert.equal(guardPublicationDraft(draft({ displayName: 'Sam‮evil' }), TAGS, NOW).reason, 'invalid_schema');
  assert.equal(guardPublicationDraft(draft({ displayName: '' }), TAGS, NOW).reason, 'invalid_schema');
  assert.equal(guardPublicationDraft(draft({ displayName: 'x'.repeat(41) }), TAGS, NOW).reason, 'invalid_schema');
});

test('publication: tags must be allowlisted, unique and bounded; sensitive free text cannot become a tag', () => {
  assert.equal(guardPublicationDraft(draft({ interestTags: ['therapy-group'] }), TAGS, NOW).reason, 'tag_not_allowlisted');
  assert.equal(guardPublicationDraft(draft({ interestTags: [] }), TAGS, NOW).reason, 'invalid_schema');
  assert.equal(guardPublicationDraft(draft({ interestTags: ['hiking', 'hiking'] }), TAGS, NOW).reason, 'invalid_schema');
  assert.equal(guardPublicationDraft(draft(), ['Not A Slug'], NOW).reason, 'tag_not_allowlisted');
});

test('publication: audience, notice version and duration must match what was shown', () => {
  assert.equal(guardPublicationDraft(draft({ audience: 'everyone' }), TAGS, NOW).reason, 'invalid_schema');
  assert.equal(guardPublicationDraft(draft({ noticeVersion: 0 }), TAGS, NOW).reason, 'stale_revision');
  assert.equal(guardPublicationDraft(draft({ expiresAtMs: NOW }), TAGS, NOW).reason, 'invalid_schema');
  assert.equal(guardPublicationDraft(draft({ expiresAtMs: NOW + PUBLICATION_MAX_LIFETIME_MS + 1 }), TAGS, NOW).reason, 'invalid_schema');
  assert.equal(guardPublicationDraft(draft({ expiresAtMs: NOW + PUBLICATION_MAX_LIFETIME_MS }), TAGS, NOW).ok, true);
});

test('area: only configured coarse area keys; coordinates, geohashes and cell ids are refused', () => {
  assert.equal(guardAreaKey('berkeley-campus', AREAS).ok, true);
  for (const k of ['37.8719,-122.2585', '9q9p3', 'berkeley-campus-block-12', 'BERKELEY', '', null]) {
    assert.notEqual(guardAreaKey(k, AREAS).ok, true, String(k));
  }
  assert.equal(AREA_MAX_LIFETIME_MS, 24 * 3600e3);
});

test('visibility: two published participants in the same area see each other', () => {
  assert.equal(vis(party('a'), party('b')).ok, true);
});

test('visibility: discovery disabled, self, unpublished or withdrawn viewer sees nothing', () => {
  assert.equal(vis(party('a'), party('b'), false, false).reason, 'disabled');
  assert.equal(vis(party('a'), party('a')).reason, 'self');
  assert.equal(vis(party('a', null), party('b')).reason, 'not_published'); // lurking is not an audience
  assert.equal(vis(party('a', { withdrawnAtMs: NOW - 1 }), party('b')).reason, 'withdrawn');
  assert.equal(vis(party('a', {}, null), party('b')).reason, 'not_published');
});

test('visibility: target withdrawn, expired (clock or sweep marker), inactive area or other area is hidden', () => {
  assert.equal(vis(party('a'), party('b', { withdrawnAtMs: NOW - 1 })).reason, 'withdrawn');
  assert.equal(vis(party('a'), party('b', { expiresAtMs: NOW })).reason, 'expired');
  assert.equal(vis(party('a'), party('b', { expiresAtMs: NOW, expiredMarked: true }), false, true, null).reason, 'expired');
  assert.equal(vis(party('a'), party('b', {}, { expiresAtMs: NOW })).reason, 'expired');
  assert.equal(vis(party('a'), party('b', {}, { active: false })).reason, 'not_published');
  assert.equal(vis(party('a'), party('b', {}, { areaKey: 'oakland-downtown' })).reason, 'area_mismatch');
});

test('visibility: views without a clock rely on the sweep marker (documented stale window)', () => {
  assert.equal(vis(party('a'), party('b', { expiresAtMs: NOW - 1 }), false, true, null).ok, true);
  assert.equal(vis(party('a'), party('b', { expiresAtMs: NOW - 1, expiredMarked: true }), false, true, null).reason, 'expired');
});

test('visibility: a block in either direction hides both people; record owner mismatch is never trusted', () => {
  assert.equal(vis(party('a'), party('b'), true).reason, 'blocked');
  const forged = party('b'); forged.publication = pub('a');
  assert.equal(vis(party('c'), forged).reason, 'not_published');
});

test('card projection carries only the approved public fields plus overlap; no identity, area or expiry', () => {
  const card = projectDiscoveryCard(pub('b', { interestTags: ['board-games', 'hiking'] }), ['hiking', 'cooking']);
  assert.deepEqual(Object.keys(card).sort(), ['cardRef', 'displayName', 'interestTags', 'revision', 'sharedTags']);
  assert.deepEqual(card.sharedTags, ['hiking']);
  assert.equal(JSON.stringify(card).includes('"b"'), true); // display name only
  assert.equal(JSON.stringify(card).includes('berkeley'), false);
});

test('error codes: block, self and area mismatch look like not_found (no block oracle)', () => {
  assert.equal(discoveryErrorCode('blocked'), 'not_found');
  assert.equal(discoveryErrorCode('self'), 'not_found');
  assert.equal(discoveryErrorCode('area_mismatch'), 'not_found');
  assert.equal(discoveryErrorCode('disabled'), 'unavailable');
  assert.equal(validSlugAllowlist(['ok-tag'], 'tag'), true);
  assert.equal(validSlugAllowlist([], 'area'), false);
});

test('D047: tag allowlists refuse sensitive labels (health, grief, sexuality, religion, status), allow ordinary ones', async () => {
  const { looksSensitiveTag, validTopicAllowlist } = await import('../dist/index.js');
  for (const ok of ['starting-college', 'new-to-city', 'new-job', 'recent-grad', 'board-games', 'hiking', 'transit-fans', 'coffee', 'books']) {
    assert.equal(looksSensitiveTag(ok), false, ok);
  }
  for (const bad of ['divorce', 'recently-divorced', 'rehab', 'sober-living', 'grief-support', 'lgbtq-meetup', 'trans-social',
    'church-group', 'new-immigrant', 'mental-health', 'self-harm', 'cancer-survivors', 'job-unemployed']) {
    assert.equal(looksSensitiveTag(bad), true, bad);
    assert.equal(validSlugAllowlist(['hiking', bad], 'tag'), false, bad);
    assert.equal(validTopicAllowlist(['hiking', bad]), false, bad);
  }
  assert.equal(validSlugAllowlist(['starting-college', 'new-to-city', 'hiking'], 'tag'), true);
  assert.equal(validSlugAllowlist(['church-street'], 'area'), true); // areas are places, not personal labels
});
