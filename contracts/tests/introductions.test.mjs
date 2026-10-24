// CYBER-R2 introduction, report and repeat-probe guards (proposed C8, D038). Offline, synthetic only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guardRateLimit, guardIntroductionRequest, guardIntroductionResponse, guardIntroductionProposalCommit,
  introductionErrorCode, introductionErrorMessage, validClientRequestId, DISCOVERY_RATE_LIMITS,
  INTRODUCTION_REQUEST_LIFETIME_MS, INTRODUCTION_DECLINE_COOLDOWN_MS, INTRODUCTION_PROPOSAL_LIFETIME_MS,
  MAX_PENDING_OUTGOING_INTRODUCTIONS, DISCOVERY_NOTICE_VERSION,
} from '../dist/index.js';
import * as zodFree from '../dist/policy.js';

const NOW = Date.parse('2026-10-24T00:00:00Z');
const H = 3600e3, D = 24 * H;
const pub = (id, over = {}) => ({ publicationId: `card-${id}`, ownerId: id, displayName: id, interestTags: ['board-games', 'hiking'],
  audience: 'area_discoverers', noticeVersion: DISCOVERY_NOTICE_VERSION, revision: 1, expiresAtMs: NOW + 7 * D,
  withdrawnAtMs: null, expiredMarked: false, ...over });
const area = (id, over = {}) => ({ ownerId: id, areaKey: 'berkeley-campus', expiresAtMs: NOW + D, active: true, expiredMarked: false, ...over });
const party = (id, p = {}, a = {}) => ({ id, publication: p === null ? null : pub(id, p), area: a === null ? null : area(id, a) });
const intro = (over = {}) => ({ introId: 'i1', senderId: 'a', recipientId: 'b', status: 'pending', senderRevision: 1,
  createdAtMs: NOW, expiresAtMs: NOW + INTRODUCTION_REQUEST_LIFETIME_MS, respondedAtMs: null, ...over });
const req = (over = {}) => guardIntroductionRequest({ sender: party('a'), recipient: party('b'), blockedEitherWay: false,
  enabled: true, nowMs: NOW, between: [], senderPendingOutgoing: 0, ...over });

test('zod-free policy entry point exposes the introduction guards for the module', () => {
  assert.equal(zodFree.guardIntroductionRequest, guardIntroductionRequest);
  assert.equal(zodFree.guardRateLimit, guardRateLimit);
});

test('rate limit: fixed window per action, refuses at max, resets after the window, never early on a clock skew back', () => {
  const { max, windowMs } = DISCOVERY_RATE_LIMITS.area_change;
  let w = null;
  for (let i = 0; i < max; i++) { const g = guardRateLimit('area_change', w, NOW + i); assert.equal(g.ok, true); w = g.next; }
  assert.deepEqual(guardRateLimit('area_change', w, NOW + 10), { ok: false, reason: 'rate_limited' });
  assert.deepEqual(guardRateLimit('area_change', w, NOW - D), { ok: false, reason: 'rate_limited' });
  assert.equal(guardRateLimit('area_change', w, NOW + windowMs).ok, true);
  assert.equal(guardRateLimit('nonsense', null, NOW).ok, false);
});

test('request: visibility is checked before relationship state (no oracle about people you cannot see)', () => {
  const declined = [intro({ status: 'declined', respondedAtMs: NOW - H, expiresAtMs: NOW + H })];
  assert.equal(req({ between: declined, blockedEitherWay: true }).reason, 'blocked');
  assert.equal(req({ between: declined, recipient: party('b', {}, { areaKey: 'oakland-downtown' }) }).reason, 'area_mismatch');
  assert.equal(req({ sender: party('a', {}, null) }).reason, 'not_published');
  assert.equal(req({ enabled: false }).reason, 'disabled');
});

test('request: expiry is the shortest of 72 h and both publications', () => {
  assert.equal(req().expiresAtMs, NOW + INTRODUCTION_REQUEST_LIFETIME_MS);
  assert.equal(req({ recipient: party('b', { expiresAtMs: NOW + H }) }).expiresAtMs, NOW + H);
});

test('request: a decline is indistinguishable from no answer, now and after the lapse', () => {
  const lapse = NOW + 10 * H;
  const declined = intro({ status: 'declined', respondedAtMs: NOW + H, expiresAtMs: lapse });
  const unanswered = intro({ expiresAtMs: lapse });
  for (const nowMs of [NOW + 2 * H, lapse + H, lapse + INTRODUCTION_DECLINE_COOLDOWN_MS - 1]) {
    const far = { sender: party('a', { expiresAtMs: nowMs + D }, { expiresAtMs: nowMs + D }),
      recipient: party('b', { expiresAtMs: nowMs + D }, { expiresAtMs: nowMs + D }) }; // both re-published since
    const a = req({ ...far, between: [declined], nowMs }), b = req({ ...far, between: [unanswered], nowMs });
    assert.equal(introductionErrorMessage(a.reason), introductionErrorMessage(b.reason));
    assert.equal(introductionErrorCode(a.reason), introductionErrorCode(b.reason));
    assert.equal(introductionErrorMessage(a.reason), 'already_requested');
  }
  const after = lapse + INTRODUCTION_DECLINE_COOLDOWN_MS;
  assert.equal(req({ between: [declined], nowMs: after, sender: party('a', { expiresAtMs: after + D }, { expiresAtMs: after + D }),
    recipient: party('b', { expiresAtMs: after + D }, { expiresAtMs: after + D }) }).ok, true);
  // the cooldown binds the asker only: the declined person may ask the other way
  assert.equal(req({ sender: party('b'), recipient: party('a'), between: [declined] }).ok, true);
});

test('request: connected, pending either way, own cancellation and the pending cap', () => {
  assert.equal(req({ between: [intro({ status: 'accepted' })] }).reason, 'already_connected');
  assert.equal(req({ between: [intro({ senderId: 'b', recipientId: 'a' })] }).reason, 'already_pending');
  assert.equal(req({ between: [intro({ status: 'cancelled' })] }).ok, true);
  assert.equal(req({ senderPendingOutgoing: MAX_PENDING_OUTGOING_INTRODUCTIONS }).reason, 'pending_limit');
  assert.equal(introductionErrorCode('pending_limit'), 'rate_limited');
});

test('response: own-action authority, pending and unexpired only', () => {
  const r = (over = {}) => guardIntroductionResponse({ intro: intro(), callerId: 'b', action: 'accept', sender: party('a'),
    recipient: party('b'), blockedEitherWay: false, enabled: true, nowMs: NOW, ...over });
  assert.deepEqual(r(), { ok: true, status: 'accepted' });
  assert.equal(r({ callerId: 'a' }).reason, 'not_participant');
  assert.equal(r({ callerId: 'c' }).reason, 'not_participant');
  assert.equal(r({ callerId: 'b', action: 'cancel' }).reason, 'not_participant');
  assert.deepEqual(r({ callerId: 'a', action: 'cancel' }), { ok: true, status: 'cancelled' });
  assert.equal(r({ intro: intro({ status: 'declined' }) }).reason, 'not_pending');
  assert.equal(r({ nowMs: NOW + INTRODUCTION_REQUEST_LIFETIME_MS }).reason, 'expired');
  assert.equal(introductionErrorCode('not_participant'), 'not_found');
});

test('response: accepting rechecks block, both publications and the sender revision; decline never needs them', () => {
  const r = (over = {}) => guardIntroductionResponse({ intro: intro(), callerId: 'b', action: 'accept', sender: party('a'),
    recipient: party('b'), blockedEitherWay: false, enabled: true, nowMs: NOW, ...over });
  assert.equal(r({ blockedEitherWay: true }).reason, 'blocked');
  assert.equal(r({ sender: party('a', { withdrawnAtMs: NOW - 1 }) }).reason, 'withdrawn');
  assert.equal(r({ recipient: party('b', { expiredMarked: true }) }).reason, 'expired');
  assert.equal(r({ sender: party('a', { revision: 2 }) }).reason, 'stale_revision');
  assert.equal(r({ enabled: false }).reason, 'disabled');
  assert.equal(r({ sender: party('x') }).reason, 'invalid_schema');
  assert.equal(r({ action: 'decline', blockedEitherWay: true, enabled: false }).ok, true);
});

test('proposal commit: only current visibility, both versions and currently shared tags; same_event waits for R3', () => {
  const base = { viewerRef: 'card-a', candidateRef: 'card-b', viewerPublicationVersion: 1, candidatePublicationVersion: 1,
    reasonCode: 'shared_interest', sharedTags: ['hiking'], openerId: 'suggest_shared_interest', expiresAtMs: NOW + 2 * D };
  const c = (over = {}, v = party('a'), t = party('b'), blocked = false) => guardIntroductionProposalCommit({ ...base, ...over }, v, t, blocked, true, NOW);
  assert.deepEqual(c(), { ok: true, expiresAtMs: NOW + INTRODUCTION_PROPOSAL_LIFETIME_MS });
  assert.equal(c({}, party('a'), party('b', { withdrawnAtMs: NOW })).reason, 'withdrawn');
  assert.equal(c({}, party('a'), party('b'), true).reason, 'blocked');
  assert.equal(c({ candidatePublicationVersion: 2 }).reason, 'stale_revision');
  assert.equal(c({ candidateRef: 'card-c' }).reason, 'invalid_schema');
  for (const over of [{ sharedTags: ['live-music'] }, { sharedTags: [] }, { sharedTags: ['hiking', 'hiking'] },
    { reasonCode: 'same_event', openerId: 'suggest_event_together', eventId: 'e1' }, { openerId: 'free text' },
    { expiresAtMs: NOW }]) {
    assert.equal(c(over).ok, false, JSON.stringify(over));
  }
  assert.equal(c({ sharedTags: ['hiking'] }, party('a'), party('b', { interestTags: ['live-music'] })).reason, 'invalid_schema');
});

test('client request ids are bounded opaque tokens', () => {
  for (const ok of ['request-0001', 'a'.repeat(64), 'AbC_123-xyz']) assert.equal(validClientRequestId(ok), true);
  for (const bad of ['short', 'a'.repeat(65), 'has space1', 'émoji-1234', 12345678, null]) assert.equal(validClientRequestId(bad), false);
});
