// PROPOSED Core 1 recipient restriction guards (Cyber, D040). Reference semantics only; not wired. Synthetic ids.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guardPauseRequest, pauseActive, guardNotPaused, pauseInvalidates, previewRecipients,
  PAUSE_MAX_LIFETIME_MS, PAUSE_MIN_LIFETIME_MS,
} from '../dist/index.js';
import * as zodFree from '../dist/policy.js';

const NOW = Date.parse('2026-10-24T00:00:00Z');
const H = 3600e3;
const pair = (over = {}) => ({ pairId: 'p1', memberA: 'sam', memberB: 'alex', status: 'accepted', ...over });
const pause = (over = {}) => ({ pauseId: 'x', ownerId: 'sam', targetId: 'alex', pairId: 'p1', version: 1, expiresAtMs: NOW + 12 * H,
  resumedAtMs: null, expiredMarked: false, ...over });

test('reducer-safe entry point exposes the pause guards', () => {
  assert.equal(zodFree.guardNotPaused, guardNotPaused);
});

test('pause targets the other pair member, derived from the pair; strangers and pending pairs refused', () => {
  assert.deepEqual(guardPauseRequest({ callerId: 'sam', pair: pair(), expiresAtMs: NOW + 12 * H, nowMs: NOW }),
    { ok: true, targetId: 'alex', expiresAtMs: NOW + 12 * H });
  assert.equal(guardPauseRequest({ callerId: 'alex', pair: pair(), expiresAtMs: NOW + H, nowMs: NOW }).targetId, 'sam');
  assert.equal(guardPauseRequest({ callerId: 'carol', pair: pair(), expiresAtMs: NOW + H, nowMs: NOW }).reason, 'not_participant');
  assert.equal(guardPauseRequest({ callerId: 'sam', pair: null, expiresAtMs: NOW + H, nowMs: NOW }).reason, 'not_participant');
  assert.equal(guardPauseRequest({ callerId: 'sam', pair: pair({ status: 'pending', memberB: null }), expiresAtMs: NOW + H, nowMs: NOW }).reason, 'pair_not_accepted');
  assert.equal(guardPauseRequest({ callerId: 'sam', pair: pair({ status: 'unlinked' }), expiresAtMs: NOW + H, nowMs: NOW }).reason, 'pair_not_accepted');
});

test('pause is clearly scoped: at least 15 minutes, at most 30 days, a real timestamp', () => {
  const g = (exp) => guardPauseRequest({ callerId: 'sam', pair: pair(), expiresAtMs: exp, nowMs: NOW });
  assert.equal(g(NOW + PAUSE_MAX_LIFETIME_MS).ok, true);
  assert.equal(g(NOW + PAUSE_MAX_LIFETIME_MS + 1).reason, 'too_long');
  assert.equal(g(NOW + PAUSE_MIN_LIFETIME_MS - 1).reason, 'too_short');
  assert.equal(g(NOW - H).reason, 'too_short');
  for (const bad of [null, '2026-10-25', 1.5, Infinity]) assert.equal(g(bad).reason, 'invalid_schema');
});

test('active only while unexpired, unresumed and not sweep-marked', () => {
  assert.equal(pauseActive(pause(), NOW), true);
  assert.equal(pauseActive(pause(), NOW + 12 * H), false);
  assert.equal(pauseActive(pause({ resumedAtMs: NOW }), NOW), false);
  assert.equal(pauseActive(pause({ expiredMarked: true }), null), false);
  assert.equal(pauseActive(pause(), null), true);
  assert.equal(pauseActive(null, NOW), false);
});

test('the check is per owner, per recipient, per pair, and refuses as "revoked" (indistinguishable from revocation)', () => {
  const ps = [pause()];
  assert.deepEqual(guardNotPaused(ps, 'sam', 'alex', 'p1', NOW), { allowed: false, reason: 'revoked' });
  assert.equal(guardNotPaused(ps, 'sam', 'jo', 'p2', NOW).allowed, true); // one person's pause never spreads
  assert.equal(guardNotPaused(ps, 'alex', 'sam', 'p1', NOW).allowed, true); // the target's own sharing is unaffected
  assert.equal(guardNotPaused(ps, 'sam', 'alex', 'p9', NOW).allowed, true);
  assert.equal(guardNotPaused(ps, 'sam', 'alex', 'p1', NOW + 13 * H).allowed, true);
});

test('a new pause revokes every standing approval to that person and suppresses derived nudges, nothing else', () => {
  const signals = [
    { signalId: 's1', senderId: 'sam', recipientId: 'alex', pairId: 'p1', revokedAtMs: null },
    { signalId: 's2', senderId: 'sam', recipientId: 'alex', pairId: 'p1', revokedAtMs: NOW - H },
    { signalId: 's3', senderId: 'sam', recipientId: 'jo', pairId: 'p2', revokedAtMs: null },
    { signalId: 's4', senderId: 'alex', recipientId: 'sam', pairId: 'p1', revokedAtMs: null },
  ];
  const nudges = [
    { nudgeId: 'n1', pairId: 'p1', sourceSignalIds: ['s1'], suppressed: false },
    { nudgeId: 'n2', pairId: 'p1', sourceSignalIds: ['s2'], suppressed: false },
    { nudgeId: 'n3', pairId: 'p2', sourceSignalIds: ['s3'], suppressed: false },
    { nudgeId: 'n4', pairId: 'p1', sourceSignalIds: ['s4'], suppressed: false },
  ];
  assert.deepEqual(pauseInvalidates({ ownerId: 'sam', targetId: 'alex', pairId: 'p1' }, signals, nudges),
    { revokeSignalIds: ['s1'], suppressNudgeIds: ['n1', 'n2'] });
});

test('preview recipients: excluded or paused people are dropped, never replaced', () => {
  const recipients = [{ pairId: 'p1', counterpartId: 'alex' }, { pairId: 'p2', counterpartId: 'jo' }, { pairId: 'p3', counterpartId: 'kim' }];
  assert.deepEqual(previewRecipients(recipients, 'sam', new Set(['jo']), [pause()], NOW).map(r => r.counterpartId), ['kim']);
  assert.deepEqual(previewRecipients(recipients, 'sam', new Set(['alex', 'jo', 'kim']), [], NOW), []);
  assert.equal(previewRecipients(recipients, 'sam', new Set(), [pause()], NOW + 13 * H).length, 3); // expiry only re-offers a preview
});
