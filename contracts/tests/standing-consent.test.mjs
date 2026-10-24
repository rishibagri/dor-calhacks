// D044 automatic nudges: standing-consent guards. Synthetic ids.
import test from 'node:test';
import assert from 'node:assert/strict';
import { guardStandingRule, standingRuleStands, standingErrorCode, STANDING_CONSENT_VERSION, STANDING_RULE_MAX_LIFETIME_MS } from '../dist/index.js';
import * as zodFree from '../dist/policy.js';

const NOW = Date.parse('2026-10-25T00:00:00Z');
const H = 3600e3;
const preset = (o = {}) => ({ allowedCategories: ['support_preference', 'coarse_availability'], version: 2, assignmentVersion: 1, expiresAtMs: NOW + 100 * 24 * H, revoked: false, ...o });
const g = (o = {}) => guardStandingRule({ pairAccepted: true, preset: preset(), categories: ['support_preference'], expiresAtMs: NOW + 7 * 24 * H,
  expectedPolicyVersion: 2, expectedAssignmentVersion: 1, noticeVersion: STANDING_CONSENT_VERSION, paused: false, nowMs: NOW, ...o });
const rule = (o = {}) => ({ ruleId: 'r', ownerId: 'a', recipientId: 'b', pairId: 'p', categories: ['support_preference'], recipientPolicyVersion: 2,
  presetAssignmentVersion: 1, noticeVersion: STANDING_CONSENT_VERSION, version: 3, expiresAtMs: NOW + H, revokedAtMs: null, expiredMarked: false, ...o });
const e = { ownerId: 'a', recipientId: 'b', pairId: 'p', categories: ['support_preference'], ruleVersion: 3 };

test('reducer-safe entry exposes the standing-consent guards', () => {
  assert.equal(zodFree.guardStandingRule, guardStandingRule);
});

test('setup: explicit, allowlisted, within the preset ceiling, shown versions and notice, bounded, never while paused', () => {
  assert.deepEqual(g(), { ok: true, categories: ['support_preference'], expiresAtMs: NOW + 7 * 24 * H });
  assert.equal(g({ pairAccepted: false }).reason, 'pair_not_accepted');
  assert.equal(g({ paused: true }).reason, 'paused');
  assert.equal(g({ categories: ['activity_interest'] }).reason, 'invalid_schema');
  assert.equal(g({ categories: [] }).reason, 'invalid_schema');
  assert.equal(g({ preset: preset({ allowedCategories: ['coarse_availability'] }) }).reason, 'blocked_category');
  assert.equal(g({ preset: null }).reason, 'no_preset');
  assert.equal(g({ expectedPolicyVersion: 1 }).reason, 'stale_policy');
  assert.equal(g({ noticeVersion: 0 }).reason, 'stale_policy');
  assert.equal(g({ expiresAtMs: NOW + STANDING_RULE_MAX_LIFETIME_MS + 1 }).reason, 'too_long');
  assert.equal(g({ expiresAtMs: NOW + 10 * 60e3 }).reason, 'too_short');
  assert.equal(g({ preset: preset({ expiresAtMs: NOW + 2 * H }) }).expiresAtMs, NOW + 2 * H); // capped by the preset
  assert.equal(standingErrorCode('no_rule'), 'unauthorized');
});

test('use: same owner/recipient/pair, current version, unrevoked, unexpired, unchanged preset, covering categories', () => {
  assert.equal(standingRuleStands(rule(), preset(), e, NOW), null);
  assert.equal(standingRuleStands(null, preset(), e, NOW), 'no_rule');
  assert.equal(standingRuleStands(rule(), preset(), { ...e, recipientId: 'c' }, NOW), 'wrong_recipient');
  assert.equal(standingRuleStands(rule({ revokedAtMs: NOW }), preset(), e, NOW), 'revoked');
  assert.equal(standingRuleStands(rule(), preset(), e, NOW + H), 'expired');
  assert.equal(standingRuleStands(rule({ expiredMarked: true }), preset(), e, null), 'expired');
  assert.equal(standingRuleStands(rule(), preset(), { ...e, ruleVersion: 2 }, NOW), 'stale_policy');
  assert.equal(standingRuleStands(rule(), preset({ version: 3 }), e, NOW), 'stale_policy');
  assert.equal(standingRuleStands(rule(), preset(), { ...e, categories: ['support_preference', 'coarse_availability'] }, NOW), 'blocked_category');
  assert.equal(standingRuleStands(rule(), preset(), { ...e, categories: [] }, NOW), 'blocked_category');
});
