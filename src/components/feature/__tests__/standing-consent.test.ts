import test from 'node:test';
import assert from 'node:assert/strict';
import { standingRuleCovers, standingRuleStatus } from '../share-review-model.ts';

const rule = { pairId: 'pair-1', categories: ['support_preference', 'coarse_availability'] as ('support_preference' | 'coarse_availability')[],
  version: 2, expiresAt: '2026-11-01T00:00:00.000Z', active: true, createdAt: '2026-10-24T00:00:00.000Z' };
const now = Date.parse('2026-10-24T12:00:00.000Z');

test('standing rule covers only its selected pair, live categories and unexpired window', () => {
  assert.equal(standingRuleCovers(rule, 'pair-1', { supportMode: 'encouraging_note' }, now), true);
  assert.equal(standingRuleCovers(rule, 'pair-1', { availability: 'this_week' }, now), true);
  assert.equal(standingRuleCovers(rule, 'pair-1', { supportMode: 'encouraging_note', availability: 'this_week' }, now), true);
  assert.equal(standingRuleCovers(rule, 'pair-2', { supportMode: 'encouraging_note' }, now), false);
  assert.equal(standingRuleCovers({ ...rule, categories: ['support_preference'] }, 'pair-1', { availability: 'this_week' }, now), false);
  assert.equal(standingRuleCovers({ ...rule, active: false }, 'pair-1', { supportMode: 'encouraging_note' }, now), false);
  assert.equal(standingRuleCovers({ ...rule, expiresAt: new Date(now).toISOString() }, 'pair-1', { supportMode: 'encouraging_note' }, now), false);
  assert.equal(standingRuleCovers(rule, 'pair-1', {}, now), false);
});

test('a rule the server reports inactive (e.g. stale after a preset re-save) never takes the automatic path', () => {
  // ShareReview only calls approve_signal_standing when this is true, so it shows the manual preview instead of a
  // failed automatic attempt.
  const stale = { ...rule, active: false };
  assert.equal(standingRuleCovers(stale, 'pair-1', { supportMode: 'encouraging_note' }, now), false);
  assert.equal(standingRuleCovers(stale, 'pair-1', { supportMode: 'encouraging_note', availability: 'this_week' }, now), false);
});

test('status for the settings list: only server-active, unexpired rules for an unpaused person with a live preset are active', () => {
  const live = { paused: false, presetExpiresAt: '2027-01-01T00:00:00.000Z' };
  assert.equal(standingRuleStatus(rule, live, now), 'active');
  assert.equal(standingRuleStatus({ ...rule, active: false }, live, now), 'inactive'); // reason not visible: neutral copy
  // Views are clockless: the device clock catches a passed expiry the sweep hasn't marked yet.
  assert.equal(standingRuleStatus(rule, live, Date.parse(rule.expiresAt)), 'expired');
  assert.equal(standingRuleStatus({ ...rule, active: false }, live, Date.parse(rule.expiresAt) + 1), 'expired');
  assert.equal(standingRuleStatus(rule, { ...live, paused: true }, now), 'paused');
  assert.equal(standingRuleStatus(rule, { ...live, presetExpiresAt: '2026-10-24T11:00:00.000Z' }, now), 'preset_expired');
  assert.equal(standingRuleStatus(rule, { ...live, presetExpiresAt: null }, now), 'active'); // server decides when no preset is visible
});
