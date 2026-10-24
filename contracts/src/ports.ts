import type { ApprovedSignal, AgentAck, Nudge } from './schemas.js';

/** Local selected data may enter the disclosed transient provider route, never shared coordination. */
export interface PrivateReflectionPort {
  reflect(selectedText: string, requestId: string): Promise<{ reflection: string }>;
}
export interface Clock { now(): Date }
export type PolicyReason = 'ok' | 'invalid_schema' | 'no_consent' | 'expired' | 'revoked' |
  'unlinked' | 'wrong_recipient' | 'stale_policy' | 'blocked_category';
export interface PolicyResult { allowed: boolean; reason: PolicyReason }
export interface DisclosurePolicyPort {
  /** Real implementations must obtain authoritative state and enforce identity server-side. */
  check(signal: unknown, recipientId: string): Promise<PolicyResult>;
}
export interface CoordinationPort {
  /** Only approved envelopes; implementation must revalidate before use and result commit. */
  coordinate(signals: ApprovedSignal[], requestId: string): Promise<{
    acknowledgements: AgentAck[]; proposedNudges: Nudge[];
  }>;
}
