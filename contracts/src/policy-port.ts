/**
 * Real DisclosurePolicyPort for Next.js routes and the worker (C6). Defence in depth only:
 * SpacetimeDB reducers enforce the same guards authoritatively, and passing here never
 * grants anything a reducer would refuse.
 */
import { ApprovedSignalSchema, type ApprovedSignal } from './schemas.js';
import type { Clock, DisclosurePolicyPort, PolicyResult } from './ports.js';
import { guardSignalUse, type PolicySnapshot, type StoredSignal } from './policy.js';

/**
 * Reads AUTHORITATIVE state for one signal (e.g. a SpacetimeDB subscription/view owned by a
 * verified server identity). Must not read anything the presented envelope supplies.
 */
export interface PolicyStateReader {
  load(signalId: string): Promise<{ signal: StoredSignal; snapshot: Omit<PolicySnapshot, 'nowMs'> } | null>;
}

/** True only when the presented envelope equals the stored record field-for-field. */
export function sameApprovedPayload(presented: ApprovedSignal, stored: StoredSignal): boolean {
  return presented.signalId === stored.signalId && presented.pairId === stored.pairId &&
    presented.senderId === stored.senderId && presented.recipientId === stored.recipientId &&
    presented.purpose === stored.purpose && presented.supportMode === stored.supportMode &&
    presented.availability === stored.availability && presented.consentVersion === stored.consentVersion &&
    presented.recipientPolicyId === stored.recipientPolicyId &&
    presented.recipientPolicyVersion === stored.recipientPolicyVersion &&
    presented.presetAssignmentVersion === stored.presetAssignmentVersion &&
    Date.parse(presented.expiresAt) === stored.expiresAtMs;
}

export class DisclosurePolicy implements DisclosurePolicyPort {
  constructor(private readonly reader: PolicyStateReader, private readonly clock: Clock) {}

  async check(input: unknown, recipientId: string): Promise<PolicyResult> {
    const parsed = ApprovedSignalSchema.safeParse(input);
    if (!parsed.success) return { allowed: false, reason: 'invalid_schema' };
    const loaded = await this.reader.load(parsed.data.signalId);
    // Unknown signal or any altered field: the owner never approved this exact payload.
    if (!loaded || !sameApprovedPayload(parsed.data, loaded.signal)) return { allowed: false, reason: 'no_consent' };
    return guardSignalUse(loaded.signal, { ...loaded.snapshot, nowMs: this.clock.now().getTime() }, recipientId);
  }
}
