import test from 'node:test';
import assert from 'node:assert/strict';
import { guardApproval } from '@dor/contracts/policy';
import type { RecipientPresetAssignment, RelationshipPreset } from '@dor/contracts';
import { describeNotReady, prepareShare, requestIdFor, shareRecipients, signalStatus } from '../share-review-model.ts';

const NOW = new Date('2026-10-24T12:00:00Z');
const OWNER = 'aa'.repeat(32);
const PEER = 'bb'.repeat(32);
const pair = { pairId: 'pair-1', counterpartIdentityHex: PEER, counterpartDisplayName: 'Sam', status: 'accepted' as const, createdAt: '2026-10-20T00:00:00Z' };
const preset = (over: Partial<RelationshipPreset> = {}): RelationshipPreset => ({
  schemaVersion: 1, policyId: 'pol-1', ownerId: OWNER, presetKind: 'friend', purpose: 'support_nudge',
  allowedCategories: ['support_preference'], approvalMode: 'each_item', version: 3,
  expiresAt: '2026-12-01T00:00:00Z', revokedAt: null, ...over,
});
const assignment: RecipientPresetAssignment = {
  schemaVersion: 1, ownerId: OWNER, recipientId: PEER, pairId: 'pair-1', presetId: 'pol-1', assignmentVersion: 2,
};
const base = { ownerHex: OWNER, pair, presets: [preset()], assignments: [assignment], now: NOW };

test('shareable preview yields exactly the payload and versions approve_signal will accept', () => {
  const r = prepareShare({ ...base, candidate: { supportMode: 'short_call', availability: 'today' } }, 'Sam');
  assert.equal(r.kind, 'ready');
  if (r.kind !== 'ready') return;
  // availability is blocked by the friend preset: omitted, never substituted
  assert.deepEqual(r.preview.payload, { supportMode: 'short_call' });
  assert.equal(r.approval.availability, undefined);
  assert.deepEqual(r.preview.blocked, ['coarse_availability']);
  assert.equal(r.approval.recipientPolicyVersion, 3);
  assert.equal(r.approval.presetAssignmentVersion, 2);
  // the module's own guard, on the same authoritative state, accepts the approval as built
  const d = guardApproval({ callerId: OWNER, ...r.approval, clientRequestId: 'req-1' }, {
    nowMs: NOW.getTime(),
    pair: { pairId: 'pair-1', memberA: OWNER, memberB: PEER, status: 'accepted' },
    preset: { policyId: 'pol-1', ownerId: OWNER, allowedCategories: ['support_preference'], version: 3, expiresAtMs: Date.parse('2026-12-01T00:00:00Z'), revokedAtMs: null },
    assignment,
  });
  assert.equal(d.allowed, true);
});

test('the full candidate (with blocked availability) would be refused, so the omission matters', () => {
  const r = prepareShare({ ...base, candidate: { supportMode: 'short_call' } }, 'Sam');
  assert.equal(r.kind, 'ready');
  if (r.kind !== 'ready') return;
  const d = guardApproval({ callerId: OWNER, ...r.approval, availability: 'today', clientRequestId: 'req-1' }, {
    nowMs: NOW.getTime(),
    pair: { pairId: 'pair-1', memberA: OWNER, memberB: PEER, status: 'accepted' },
    preset: { policyId: 'pol-1', ownerId: OWNER, allowedCategories: ['support_preference'], version: 3, expiresAtMs: Date.parse('2026-12-01T00:00:00Z'), revokedAtMs: null },
    assignment,
  });
  assert.equal(d.allowed, false);
});

test('no assignment to this person means no approval and a clear reason', () => {
  const r = prepareShare({ ...base, assignments: [], candidate: { supportMode: 'short_call' } }, 'Sam');
  assert.equal(r.kind, 'not_ready');
  if (r.kind === 'not_ready') assert.match(describeNotReady(r), /No preset is assigned/);
});

test('an assignment for a different recipient or by a different owner is ignored', () => {
  const other = { ...assignment, recipientId: 'cc'.repeat(32) };
  const foreign = { ...assignment, ownerId: 'dd'.repeat(32) };
  for (const a of [other, foreign]) {
    assert.equal(prepareShare({ ...base, assignments: [a], candidate: { supportMode: 'short_call' } }, 'Sam').kind, 'not_ready');
  }
});

test('revoked or expired preset, null or malformed candidate never yields an approval', () => {
  const cases = [
    { ...base, presets: [preset({ revokedAt: '2026-10-23T00:00:00Z' })], candidate: { supportMode: 'short_call' as const } },
    { ...base, presets: [preset({ expiresAt: '2026-10-24T11:00:00Z' })], candidate: { supportMode: 'short_call' as const } },
    { ...base, candidate: null },
    { ...base, candidate: { supportMode: 'short_call', note: 'synthetic' } as never },
  ];
  for (const c of cases) assert.equal(prepareShare(c, 'Sam').kind, 'not_ready');
  const r = prepareShare({ ...base, candidate: null }, 'Sam');
  if (r.kind === 'not_ready') assert.match(describeNotReady(r), /Nothing/);
});

test('availability-only shareable preview has no recipient copy (no nudge)', () => {
  const r = prepareShare({ ...base, presets: [preset({ allowedCategories: ['coarse_availability'] })], candidate: { availability: 'this_week' } }, 'Sam');
  assert.equal(r.kind === 'ready' && r.preview.recipientCopy, null);
});

test('only accepted pairs with a counterpart are share recipients', () => {
  const list = shareRecipients([pair, { ...pair, pairId: 'p2', status: 'pending' }, { ...pair, pairId: 'p3', counterpartIdentityHex: null }]);
  assert.deepEqual(list.map((r) => r.pairId), ['pair-1']);
});

test('signal status: revoked beats expiry; expiry is strict', () => {
  const now = NOW.getTime();
  assert.equal(signalStatus({ revokedAt: null, expiresAt: '2026-10-25T00:00:00Z' }, now), 'active');
  assert.equal(signalStatus({ revokedAt: '2026-10-24T00:00:00Z', expiresAt: '2026-10-25T00:00:00Z' }, now), 'revoked');
  assert.equal(signalStatus({ revokedAt: null, expiresAt: NOW.toISOString() }, now), 'expired');
});

test('request ID is reused for a retry of the same payload and fresh when versions change', () => {
  let n = 0;
  const mint = () => `id-${++n}`;
  const r = prepareShare({ ...base, candidate: { supportMode: 'short_call' } }, 'Sam');
  assert.equal(r.kind, 'ready');
  if (r.kind !== 'ready') return;
  const first = requestIdFor(r.approval, null, mint);
  assert.equal(requestIdFor(r.approval, first, mint).id, first.id);
  const bumped = prepareShare({ ...base, presets: [preset({ version: 4 })], candidate: { supportMode: 'short_call' } }, 'Sam');
  if (bumped.kind !== 'ready') return assert.fail('expected ready');
  assert.notEqual(bumped.approval.payloadRevision, r.approval.payloadRevision);
  assert.notEqual(requestIdFor(bumped.approval, first, mint).id, first.id);
});

test('two unnamed connections get distinct stable labels by creation time then pair id', () => {
  const list = shareRecipients([
    { ...pair, pairId: 'b', counterpartDisplayName: null, createdAt: '2026-10-21T00:00:00Z' },
    { ...pair, pairId: 'a', counterpartDisplayName: '  ', createdAt: '2026-10-22T00:00:00Z' },
  ]);
  assert.deepEqual(list.map((r) => [r.pairId, r.name, r.unnamed]), [['b', 'Connection 1', true], ['a', 'Connection 2', true]]);
});

test('duplicate display names are suffixed in stable order and named ones keep their names', () => {
  const list = shareRecipients([
    { ...pair, pairId: 'p2', counterpartDisplayName: 'sam', createdAt: '2026-10-22T00:00:00Z' },
    { ...pair, pairId: 'p1', counterpartDisplayName: 'Sam', createdAt: '2026-10-21T00:00:00Z' },
    { ...pair, pairId: 'p3', counterpartDisplayName: 'Alex', createdAt: '2026-10-23T00:00:00Z' },
  ]);
  assert.deepEqual(list.map((r) => r.name), ['sam (2)', 'Sam', 'Alex']);
});
