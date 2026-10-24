/** Proposed shared contracts; ApprovedSignal v2 adds preset/recipient policy bindings; runtime validators must enforce this on every boundary. */
export type SupportMode = 'short_call' | 'encouraging_note' | 'shared_activity';
export type Availability = 'today' | 'this_week' | 'no_preference';
export interface ApprovedSignal {
  schemaVersion: 2;
  signalId: string;
  pairId: string;
  senderId: string;
  recipientId: string;
  purpose: 'support_nudge';
  /** Runtime schema requires at least one permitted category. */
  supportMode?: SupportMode;
  availability?: Availability;
  consentVersion: number;
  recipientPolicyId: string;
  recipientPolicyVersion: number;
  presetAssignmentVersion: number;
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

/** Permission ceiling only. Existing per-item approval remains mandatory. */
export type SharingCategory = 'support_preference' | 'coarse_availability';
export type RelationshipPresetKind = 'partner' | 'friend' | 'family';
export interface RelationshipPreset {
  schemaVersion: 1;
  policyId: string;
  ownerId: string;
  presetKind: RelationshipPresetKind;
  purpose: 'support_nudge';
  allowedCategories: SharingCategory[];
  approvalMode: 'each_item';
  version: number;
  expiresAt: string;
  revokedAt: string | null;
}
/** Owner-only encrypted local data; never a shared profile or authorization token. */
export interface LocalConnectionProfile {
  schemaVersion: 1;
  communicationStyle: 'direct' | 'gentle' | 'playful' | null;
  preferredSupportModes: SupportMode[];
  draftSharingCategories: SharingCategory[];
  rhythm: 'spontaneous' | 'planned' | 'flexible' | null;
  suggestionIntensity: 'fewer' | 'quiet' | 'paused' | null;
}

/** No per-person category overrides: permissions come from the referenced preset. */
export interface RecipientPresetAssignment {
  schemaVersion: 1;
  ownerId: string;
  recipientId: string;
  pairId: string;
  presetId: string;
  assignmentVersion: number;
}
