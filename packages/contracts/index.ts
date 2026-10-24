/** Proposed shared contract v1; runtime validators must enforce this on every boundary. */
export type SupportMode = 'short_call' | 'encouraging_note' | 'shared_activity';
export type Availability = 'today' | 'this_week' | 'no_preference';
export interface ApprovedSignal {
  schemaVersion: 1;
  signalId: string;
  pairId: string;
  senderId: string;
  recipientId: string;
  purpose: 'support_nudge';
  supportMode: SupportMode;
  availability: Availability;
  consentVersion: number;
  expiresAt: string;
}
export interface AgentAck {
  schemaVersion: 1;
  signalId: string;
  recipientConsentId: string;
  recipientConsentVersion: number;
  decision: 'compatible' | 'decline';
  supportMode?: SupportMode;
  availability?: Availability;
}
export interface Nudge {
  id: string;
  pairId: string;
  recipientId: string;
  sourceSignalIds: string[];
  sourceConsentVersions: number[];
  templateId: 'offer_short_call' | 'offer_note' | 'offer_shared_activity';
  createdAt: string;
  expiresAt: string;
}
export interface PolicyResult {
  allowed: boolean;
  reason: 'ok' | 'invalid_schema' | 'no_consent' | 'expired' | 'revoked' | 'unlinked' | 'wrong_recipient';
}
