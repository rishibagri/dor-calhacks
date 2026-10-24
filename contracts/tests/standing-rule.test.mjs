// D047 standing-rule guards (CS). Offline, synthetic ids.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guardRuleCreation, guardRuleApproval, standingRuleActive, StandingRuleSchema, policyErrorCode,
  STANDING_RULE_MIN_MS, STANDING_RULE_MAX_MS, STANDING_RULE_PURPOSES, SIGNAL_LIFETIME_MS,
} from '../dist/index.js';
import * as zodFree from '../dist/policy.js';

const NOW = Date.parse('2026-10-24T00:00:00Z');
const H = 3600e3;
const A = 'alice-id', B = 'bob-id', C = 'carol-id';
const world = (cats = ['support_preference', 'coarse_availability']) => ({
  nowMs: NOW,
  pair: { pairId: 'pair-1', memberA: A, memberB: B, status: 'accepted' },
  assignment: { ownerId: A, recipientId: B, pairId: 'pair-1', presetId: 'preset-1', assignmentVersion: 1 },
  preset: { policyId: 'preset-1', ownerId: A, allowedCategories: cats, version: 3, expiresAtMs: NOW + 90 * 24 * H, revokedAtMs: null },
});
const rule = (over = {}) => ({ ruleId: 'r1', ownerId: A, pairId: 'pair-1', supportModes: ['short_call'], availability: ['this_week'],
  purpose: 'support_check_in', version: 1, expiresAtMs: NOW + 48 * H, revokedAtMs: null, expiredMarked: false, ...over });
const create = (over = {}, s = world()) => guardRuleCreation({ callerId: A, pairId: 'pair-1', supportModes: ['short_call'],
  availability: ['this_week'], purpose: 'support_check_in', expiresAtMs: NOW + 48 * H, ...over }, s);
const approve = (over = {}, r = rule(), s = world()) => guardRuleApproval({ callerId: A, pairId: 'pair-1', supportMode: 'short_call',
  availability: 'this_week', ruleVersion: 1, clientRequestId: 'req-1', ...over }, { ...s, rule: r });

test('reducer-safe entry point exposes the rule guards and constants', () => {
  assert.equal(zodFree.guardRuleApproval, guardRuleApproval);
  assert.equal(zodFree.guardRuleCreation, guardRuleCreation);
  assert.deepEqual([...STANDING_RULE_PURPOSES], ['support_check_in']);
});

test('creation: a subset of the current preset is allowed; recipient derived from the pair', () => {
  assert.deepEqual(create(), { allowed: true, reason: 'ok', recipientId: B });
  assert.equal(create({ supportModes: ['short_call', 'encouraging_note'], availability: [] }).allowed, true);
});

test('creation never broadens the preset', () => {
  assert.deepEqual(create({}, world(['coarse_availability'])), { allowed: false, reason: 'blocked_category' });
  assert.deepEqual(create({ availability: [] }, world(['coarse_availability'])), { allowed: false, reason: 'blocked_category' });
  assert.deepEqual(create({ supportModes: [] }, world(['support_preference'])), { allowed: false, reason: 'blocked_category' });
  assert.equal(create({}, { ...world(), preset: null }).reason, 'no_consent');
  assert.equal(create({}, { ...world(), preset: { ...world().preset, revokedAtMs: NOW } }).reason, 'revoked');
});

test('creation: bounded expiry, fixed purpose, strict enums, accepted pair, membership', () => {
  assert.equal(create({ expiresAtMs: NOW + STANDING_RULE_MIN_MS - 1 }).reason, 'invalid_schema');
  assert.equal(create({ expiresAtMs: NOW + STANDING_RULE_MAX_MS + 1 }).reason, 'invalid_schema');
  assert.equal(create({ expiresAtMs: NOW + STANDING_RULE_MAX_MS }).allowed, true);
  assert.equal(create({ expiresAtMs: NOW + STANDING_RULE_MIN_MS }).allowed, true);
  assert.equal(create({ purpose: 'anything' }).reason, 'invalid_schema');
  assert.equal(create({ supportModes: ['x'] }).reason, 'invalid_schema');
  assert.equal(create({ supportModes: ['short_call', 'short_call'] }).reason, 'invalid_schema');
  assert.equal(create({ supportModes: [], availability: [] }).reason, 'invalid_schema');
  assert.equal(create({ callerId: C }).reason, 'wrong_recipient');
  assert.equal(create({}, { ...world(), pair: { ...world().pair, status: 'unlinked' } }).reason, 'unlinked');
  assert.equal(create({}, { ...world(), pair: { ...world().pair, status: 'pending' } }).reason, 'no_consent');
});

test('approval by rule: allowed with the preset versions read by the server; expiry clamped to the rule', () => {
  const d = approve();
  assert.equal(d.allowed, true);
  assert.equal(d.recipientId, B);
  assert.equal(d.recipientPolicyId, 'preset-1');
  assert.equal(d.expiresAtMs, NOW + 24 * H); // min(now + signal lifetime, rule expiry)
  assert.equal(approve({}, rule({ expiresAtMs: NOW + 2 * H })).expiresAtMs, NOW + 2 * H);
  assert.equal(SIGNAL_LIFETIME_MS, 24 * H);
});

test('approval by rule: rule state is rechecked (missing, revoked, expired, version)', () => {
  assert.equal(approve({}, null).reason, 'no_consent');
  assert.equal(approve({}, rule({ revokedAtMs: NOW - 1 })).reason, 'revoked');
  assert.equal(approve({}, rule({ expiresAtMs: NOW })).reason, 'expired');
  assert.equal(approve({}, rule({ expiredMarked: true })).reason, 'expired');
  assert.equal(approve({ ruleVersion: 2 }).reason, 'stale_policy');
  assert.equal(approve({ ruleVersion: 0 }).reason, 'invalid_schema');
  assert.equal(approve({}, rule({ ownerId: B })).reason, 'wrong_recipient');
  assert.equal(approve({}, rule({ pairId: 'other' })).reason, 'wrong_recipient');
});

test('approval by rule: payload must be inside the rule AND the current preset', () => {
  assert.equal(approve({ supportMode: 'encouraging_note' }).reason, 'blocked_category');
  assert.equal(approve({ availability: 'today' }).reason, 'blocked_category');
  assert.equal(approve({ supportMode: undefined }).allowed, true);
  assert.equal(approve({ supportMode: undefined, availability: undefined }).reason, 'invalid_schema');
  // The rule says yes, the (tightened) preset says no: the preset is the ceiling.
  assert.equal(approve({}, rule(), world(['coarse_availability'])).reason, 'blocked_category');
  assert.equal(approve({}, rule(), { ...world(), assignment: null }).reason, 'no_consent');
  assert.equal(approve({}, rule(), { ...world(), preset: { ...world().preset, expiresAtMs: NOW } }).reason, 'expired');
});

test('approval by rule: non-members, strangers and unlinked pairs', () => {
  assert.equal(approve({ callerId: C }).reason, 'wrong_recipient');
  assert.equal(approve({}, rule(), { ...world(), pair: null }).reason, 'wrong_recipient');
  assert.equal(approve({}, rule(), { ...world(), pair: { ...world().pair, status: 'unlinked' } }).reason, 'unlinked');
  assert.equal(policyErrorCode(approve({ callerId: C }).reason), 'not_found');
});

test('standingRuleActive fails closed in clockless views via the sweep marker', () => {
  assert.equal(standingRuleActive(rule(), null), true);
  assert.equal(standingRuleActive(rule({ expiredMarked: true }), null), false);
  assert.equal(standingRuleActive(rule({ revokedAtMs: 1 }), null), false);
  assert.equal(standingRuleActive(rule({ expiresAtMs: NOW }), NOW), false);
  assert.equal(standingRuleActive(null, null), false);
});

test('StandingRuleSchema is strict and enum-only', () => {
  const ok = { schemaVersion: 1, pairId: 'p', supportModes: ['short_call'], availability: [], purpose: 'support_check_in',
    version: 1, expiresAt: '2026-10-25T00:00:00Z' };
  assert.equal(StandingRuleSchema.safeParse(ok).success, true);
  assert.equal(StandingRuleSchema.safeParse({ ...ok, note: 'free text' }).success, false);
  assert.equal(StandingRuleSchema.safeParse({ ...ok, purpose: 'x' }).success, false);
  assert.equal(StandingRuleSchema.safeParse({ ...ok, supportModes: [], availability: [] }).success, false);
  assert.equal(StandingRuleSchema.safeParse({ ...ok, supportModes: ['short_call', 'short_call'] }).success, false);
});
