import test from 'node:test';
import assert from 'node:assert/strict';
import { RelationshipPresetSchema, SHARING_CATEGORIES } from '@dor/contracts';
import { ACTIVITY_CATEGORY } from '@dor/contracts/policy';
import { mapPreset } from '../mappers.ts';
import { readViews } from '../views.ts';
import { reducerArgs } from '../reducer_args.ts';
import type { LooseConnection, LooseRow } from '../bindings.ts';

const OWNER = 'a'.repeat(64);
const row = (allowed: string[], extra: Partial<LooseRow> = {}): LooseRow => ({
  policy_id: 'preset-1', owner_id: OWNER, preset_kind: 'friend', allowed_categories: allowed, version: 3,
  expires_at: '2027-01-01T00:00:00.000Z', revoked_at: null, ...extra,
});
const conn = (views: Record<string, LooseRow[]>): LooseConnection =>
  ({ db: Object.fromEntries(Object.entries(views).map(([k, rows]) => [k, { iter: () => rows }])), reducers: {} }) as unknown as LooseConnection;

test('a preset that also allows activity_interest is kept, with activity as a separate flag (D049)', () => {
  const p = mapPreset(row(['support_preference', ACTIVITY_CATEGORY]));
  assert.ok(p, 'the whole preset must not disappear');
  assert.deepEqual(p.allowedCategories, ['support_preference']);
  assert.equal(p.activityInterestAllowed, true);
  assert.equal(mapPreset(row(['coarse_availability']))?.activityInterestAllowed, false);
  assert.equal(mapPreset(row([ACTIVITY_CATEGORY]))?.allowedCategories.length, 0); // activity only: no core category
});

test('activity_interest can never be a core sharing category', () => {
  assert.ok(!(SHARING_CATEGORIES as readonly string[]).includes(ACTIVITY_CATEGORY));
  const base = { schemaVersion: 1, policyId: 'p', ownerId: OWNER, presetKind: 'friend', purpose: 'support_nudge',
    approvalMode: 'each_item', version: 1, expiresAt: '2027-01-01T00:00:00.000Z', revokedAt: null };
  assert.equal(RelationshipPresetSchema.safeParse({ ...base, allowedCategories: [ACTIVITY_CATEGORY] }).success, false);
  assert.equal(RelationshipPresetSchema.safeParse({ ...base, allowedCategories: [], activityInterestAllowed: true }).success, true);
  for (const allowed of [['support_preference', ACTIVITY_CATEGORY], [ACTIVITY_CATEGORY, 'coarse_availability']]) {
    assert.ok(!(mapPreset(row(allowed))!.allowedCategories as string[]).includes(ACTIVITY_CATEGORY));
  }
});

test('unknown or duplicate categories still fail closed, and are reported instead of vanishing', () => {
  assert.equal(mapPreset(row(['support_preference', 'journal_text'])), null);
  assert.equal(mapPreset(row([ACTIVITY_CATEGORY, ACTIVITY_CATEGORY])), null);
  const v = readViews(conn({ my_presets: [row(['support_preference']), row(['journal_text'], { policy_id: 'preset-2' })] }));
  assert.equal(v.presets.length, 1);
  assert.deepEqual(v.unreadable.presets, [{ id: 'preset-2', pairId: null }]);
  assert.equal(v.unreadable.counts.my_presets, 1);
});

test('unreadable diagnostics carry only the view name, a count and the row\'s own id', () => {
  const secret = 'SECRET-private-text';
  const v = readViews(conn({
    my_presets: [row([secret])],
    my_pairs: [{ pair_id: 'pair-1', status: secret, created_at: '2026-10-24T00:00:00.000Z' }],
  }));
  assert.deepEqual(v.unreadable.counts, { my_presets: 1, my_pairs: 1 });
  assert.ok(!JSON.stringify(v.unreadable).includes(secret));
});

test('saving a preset sends activity_interest only as the explicit activity permission', () => {
  const base = { presetKind: 'friend' as const, allowedCategories: ['support_preference' as const], expectedVersion: 3,
    expiresAt: '2027-01-01T00:00:00.000Z' };
  assert.deepEqual(reducerArgs.setRelationshipPreset({ ...base, activityInterestAllowed: true }).allowedCategories,
    ['support_preference', ACTIVITY_CATEGORY]);
  assert.deepEqual(reducerArgs.setRelationshipPreset({ ...base, activityInterestAllowed: false }).allowedCategories, ['support_preference']);
  assert.deepEqual(reducerArgs.setRelationshipPreset(base).allowedCategories, ['support_preference']);
  // A smuggled core-list entry is refused before it reaches the reducer.
  assert.throws(() => reducerArgs.setRelationshipPreset({ ...base, allowedCategories: [ACTIVITY_CATEGORY as never] }), /invalid/);
});
