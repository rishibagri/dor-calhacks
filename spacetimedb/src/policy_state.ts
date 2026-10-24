// Builds C6 guard snapshots from authoritative private tables (Cyber; CS plumbing).
// Always read in the same transaction as the write the guard protects.
import type { Identity, Timestamp } from 'spacetimedb';
import type { InferSchema, ViewCtx } from 'spacetimedb/server';
import type { PolicySnapshot, StoredSignal } from '@kinetic/contracts/policy';
import type { spacetimedb } from './schema';
import type { Ctx } from './errors';

/** Read-only table access shared by reducer and view contexts. */
export type ReadDb = ViewCtx<InferSchema<typeof spacetimedb>>['db'];
type SignalRow = NonNullable<ReturnType<Ctx['db']['approved_signal']['signal_id']['find']>>;

export const hex = (id: Identity): string => id.toHexString();
export const toMs = (ts: Timestamp): number => Number(ts.microsSinceUnixEpoch / 1000n);
export const fromMs = (ms: number): bigint => BigInt(ms) * 1000n;

/** Pair + the owner's assignment in it + the confirmed preset that assignment points at. */
export function loadStanding(db: ReadDb, owner: Identity, pairId: string): Omit<PolicySnapshot, 'nowMs'> {
  const p = db.pair.pair_id.find(pairId);
  const pair = p ? { pairId: p.pair_id, memberA: hex(p.member_a), memberB: p.member_b ? hex(p.member_b) : null, status: p.status } : null;
  const a = [...db.preset_assignment.iter()].find(r => r.pair_id === pairId && r.owner.isEqual(owner));
  const preset = a ? [...db.relationship_preset.iter()].find(r => r.owner.isEqual(owner) && r.preset_kind === a.preset_kind) : undefined;
  return {
    pair,
    assignment: a && preset ? {
      ownerId: hex(a.owner), recipientId: hex(a.recipient), pairId: a.pair_id,
      presetId: preset.preset_id, assignmentVersion: a.assignment_version,
    } : null,
    preset: preset ? {
      policyId: preset.preset_id, ownerId: hex(preset.owner), allowedCategories: preset.allowed_categories,
      version: preset.version, expiresAtMs: toMs(preset.expires_at),
      revokedAtMs: preset.revoked_at ? toMs(preset.revoked_at) : null,
    } : null,
  };
}

export function toStoredSignal(s: SignalRow): StoredSignal {
  return {
    signalId: s.signal_id, pairId: s.pair_id, senderId: hex(s.sender_id), recipientId: hex(s.recipient_id),
    purpose: s.purpose, supportMode: s.support_mode, availability: s.availability,
    consentVersion: s.consent_version, recipientPolicyId: s.recipient_policy_id,
    recipientPolicyVersion: s.recipient_policy_version, presetAssignmentVersion: s.preset_assignment_version,
    expiresAtMs: toMs(s.expires_at), revokedAtMs: s.revoked_at ? toMs(s.revoked_at) : null,
  };
}
