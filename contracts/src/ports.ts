import type { ApprovedSignal, AgentAck, CoordinationOutcome, Nudge, PrivateReflection,
  VoiceSession } from './schemas.js';

/** Local selected data may enter the disclosed transient provider route, never shared coordination. */
export interface PrivateReflectionPort {
  /** Result belongs in the owner's local vault only; the candidate is a draft, never consent. */
  reflect(selectedText: string, requestId: string): Promise<PrivateReflection>;
}
/** Server-side provider adapter behind authenticated, non-logging routes. Audio and text are transient. */
export interface VoicePort {
  createSession(requestId: string): Promise<VoiceSession>;
  transcribe(audio: Uint8Array, requestId: string): Promise<{ text: string }>;
  synthesize(text: string, requestId: string): Promise<{ audio: Uint8Array; mimeType: string }>;
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
    acknowledgements: AgentAck[]; proposedNudges: Nudge[]; outcomes: CoordinationOutcome[];
  }>;
}
