import test from 'node:test';
import assert from 'node:assert/strict';
import { standingRuleCovers } from '../share-review-model.ts';

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

