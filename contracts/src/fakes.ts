/** OFFLINE TEST DOUBLE ONLY: no auth, encryption, persistence, or race protection. */
import { ApprovedSignalSchema, type ApprovedSignal, type RelationshipPreset,
  type RecipientPresetAssignment } from './schemas.js';
import type { Clock, DisclosurePolicyPort, PolicyResult } from './ports.js';
export class FakeClock implements Clock {
  constructor(private timestamp: string) {}
  now(): Date { return new Date(this.timestamp); }
  set(timestamp: string): void { this.timestamp = timestamp; }
}
export class FakeDisclosurePolicy implements DisclosurePolicyPort {
  constructor(private readonly state: {
    clock: Clock; preset: RelationshipPreset; assignment: RecipientPresetAssignment;
    approved: ApprovedSignal | null; linked: boolean; revoked: boolean;
  }) {}
  async check(input: unknown, recipientId: string): Promise<PolicyResult> {
    const deny = (reason: PolicyResult['reason']): PolicyResult => ({ allowed: false, reason });
    const parsed = ApprovedSignalSchema.safeParse(input);
    if (!parsed.success) return deny('invalid_schema');
    const s = parsed.data, p = this.state.preset, a = this.state.assignment;
    if (recipientId !== s.recipientId || a.recipientId !== s.recipientId ||
      a.ownerId !== s.senderId || a.pairId !== s.pairId || p.ownerId !== s.senderId)
      return deny('wrong_recipient');
    if (!this.state.linked) return deny('unlinked');
    if (this.state.revoked || p.revokedAt !== null) return deny('revoked');
    if (p.policyId !== s.recipientPolicyId || a.presetId !== p.policyId ||
      p.version !== s.recipientPolicyVersion || a.assignmentVersion !== s.presetAssignmentVersion)
      return deny('stale_policy');
    if (Date.parse(s.expiresAt) <= this.state.clock.now().getTime() ||
      Date.parse(p.expiresAt) <= this.state.clock.now().getTime()) return deny('expired');
    if ((s.supportMode !== undefined && !p.allowedCategories.includes('support_preference')) ||
      (s.availability !== undefined && !p.allowedCategories.includes('coarse_availability')))
      return deny('blocked_category');
    // Compare exact validated payloads with stable key order; never accept schema validity as consent.
    const approved = ApprovedSignalSchema.safeParse(this.state.approved);
    if (!approved.success || JSON.stringify(approved.data) !== JSON.stringify(s)) return deny('no_consent');
    return { allowed: true, reason: 'ok' };
  }
}
