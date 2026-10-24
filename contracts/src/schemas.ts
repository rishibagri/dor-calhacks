import { z } from 'zod';
import { AVAILABILITIES, DISCLOSURE_PURPOSE, NUDGE_TEMPLATE_IDS, RELATIONSHIP_PRESET_KINDS,
  SHARING_CATEGORIES, SUPPORT_MODES } from './enums.js';
import { STANDING_RULE_PURPOSES } from './standing-rule.js';

const id = z.string().min(1).max(128);
const time = z.string().datetime({ offset: true });
export const SupportModeSchema = z.enum(SUPPORT_MODES);
export const AvailabilitySchema = z.enum(AVAILABILITIES);
export const SharingCategorySchema = z.enum(SHARING_CATEGORIES);
export const RelationshipPresetKindSchema = z.enum(RELATIONSHIP_PRESET_KINDS);
export const ApprovedSignalSchema = z.object({
  schemaVersion: z.literal(2), signalId: id, pairId: id, senderId: id, recipientId: id,
  purpose: z.literal(DISCLOSURE_PURPOSE), supportMode: SupportModeSchema.optional(),
  availability: AvailabilitySchema.optional(), consentVersion: z.number().int().positive(),
  recipientPolicyId: id, recipientPolicyVersion: z.number().int().positive(),
  presetAssignmentVersion: z.number().int().positive(), expiresAt: time,
}).strict().refine(s => s.supportMode !== undefined || s.availability !== undefined,
  'At least one approved sharing category is required');
export const RelationshipPresetSchema = z.object({
  schemaVersion: z.literal(1), policyId: id, ownerId: id, presetKind: RelationshipPresetKindSchema,
  purpose: z.literal(DISCLOSURE_PURPOSE), allowedCategories: z.array(SharingCategorySchema)
    .refine(v => new Set(v).size === v.length, 'Duplicate categories'),
  approvalMode: z.literal('each_item'), version: z.number().int().positive(),
  expiresAt: time, revokedAt: time.nullable(),
}).strict();
export const RecipientPresetAssignmentSchema = z.object({
  schemaVersion: z.literal(1), ownerId: id, recipientId: id, pairId: id,
  presetId: id, assignmentVersion: z.number().int().positive(),
}).strict();
export const LocalConnectionProfileSchema = z.object({
  schemaVersion: z.literal(1), communicationStyle: z.enum(['direct', 'gentle', 'playful']).nullable(),
  preferredSupportModes: z.array(SupportModeSchema), draftSharingCategories: z.array(SharingCategorySchema),
  rhythm: z.enum(['spontaneous', 'planned', 'flexible']).nullable(),
  suggestionIntensity: z.enum(['fewer', 'quiet', 'paused']).nullable(),
}).strict();
export const AgentAckSchema = z.object({
  schemaVersion: z.literal(1), signalId: id, recipientConsentId: id,
  recipientConsentVersion: z.number().int().positive(), decision: z.enum(['compatible', 'decline']),
  supportMode: SupportModeSchema.optional(), availability: AvailabilitySchema.optional(),
}).strict();
export const NudgeSchema = z.object({
  schemaVersion: z.literal(1), id, pairId: id, recipientId: id,
  sourceSignalIds: z.array(id).min(1), sourceConsentVersions: z.array(z.number().int().positive()).min(1),
  templateId: z.enum(NUDGE_TEMPLATE_IDS),
  createdAt: time, expiresAt: time,
}).strict().refine(n => n.sourceSignalIds.length === n.sourceConsentVersions.length,
  'Every source signal must have a corresponding consent version');
export const DisclosureReceiptSchema = z.object({
  schemaVersion: z.literal(1), receiptId: id, signalId: id, senderId: id, recipientId: id,
  categories: z.array(SharingCategorySchema).min(1), consentVersion: z.number().int().positive(),
  recipientPolicyVersion: z.number().int().positive(), presetAssignmentVersion: z.number().int().positive(),
  action: z.enum(['approved', 'used', 'revoked', 'suppressed']), createdAt: time,
}).strict();
const unique = <T>(v: T[]) => new Set(v).size === v.length;
/** C1 browser voice session from POST /api/voice/session. Short-lived scoped token, never the provider master key. */
export const VoiceSessionSchema = z.object({
  schemaVersion: z.literal(1), provider: z.literal('cartesia'), accessToken: z.string().min(1).max(4096),
  expiresAt: time, apiVersion: id, sttModel: id, sttEncoding: z.literal('pcm_s16le'),
  sttSampleRate: z.literal(16000), ttsModel: id, ttsVoiceId: id,
}).strict();
/** C4 recipient's own consented preferences; the only recipient input an ACK may use. */
export const RecipientSupportPreferencesSchema = z.object({
  schemaVersion: z.literal(1), consentId: id, consentVersion: z.number().int().positive(),
  pairId: id, recipientId: id, purpose: z.literal('support_nudge'),
  supportModes: z.array(SupportModeSchema).min(1).refine(unique, 'Duplicate support modes'),
  availability: z.array(AvailabilitySchema).refine(unique, 'Duplicate availability windows'),
  expiresAt: time, revokedAt: time.nullable(),
}).strict();
/** C4 content-free trigger: IDs only, never transcripts or candidate drafts. */
export const CoordinationJobSchema = z.object({
  schemaVersion: z.literal(1), jobId: id, pairId: id, requestId: id,
  signalIds: z.array(id).min(1).max(4).refine(unique, 'Duplicate signal IDs'), createdAt: time,
}).strict();
export const CoordinationOutcomeCodeSchema = z.enum(['nudge_proposed', 'policy_denied', 'preferences_unavailable',
  'no_intersection', 'recipient_declined', 'not_opted_in', 'quiet_hours', 'cooldown', 'proposer_failed_fallback',
  'proposer_failed_no_suggestion']);
/** C4 sanitized result record: codes, IDs and versions only. */
export const CoordinationOutcomeSchema = z.object({
  schemaVersion: z.literal(1), requestId: id, pairId: id, signalIds: z.array(id).min(1),
  outcome: CoordinationOutcomeCodeSchema, rounds: z.number().int().min(0).max(2),
  nudgeId: id.optional(), decidedBy: z.enum(['none', 'agent', 'fixed_template']),
}).strict();
export type SupportMode = z.infer<typeof SupportModeSchema>;
export type Availability = z.infer<typeof AvailabilitySchema>;
export type SharingCategory = z.infer<typeof SharingCategorySchema>;
export type RelationshipPresetKind = z.infer<typeof RelationshipPresetKindSchema>;
export type ApprovedSignal = z.infer<typeof ApprovedSignalSchema>;
export type RelationshipPreset = z.infer<typeof RelationshipPresetSchema>;
export type RecipientPresetAssignment = z.infer<typeof RecipientPresetAssignmentSchema>;
export type LocalConnectionProfile = z.infer<typeof LocalConnectionProfileSchema>;
export type AgentAck = z.infer<typeof AgentAckSchema>;
export type Nudge = z.infer<typeof NudgeSchema>;
export type DisclosureReceipt = z.infer<typeof DisclosureReceiptSchema>;
export type VoiceSession = z.infer<typeof VoiceSessionSchema>;
export type RecipientSupportPreferences = z.infer<typeof RecipientSupportPreferencesSchema>;
export type CoordinationJob = z.infer<typeof CoordinationJobSchema>;
export type CoordinationOutcomeCode = z.infer<typeof CoordinationOutcomeCodeSchema>;
export type CoordinationOutcome = z.infer<typeof CoordinationOutcomeSchema>;

/**
 * D047 standing rule as the owner sees it. Strict; enum-only, unique, at least one category; no free text.
 * The server also bounds the expiry (STANDING_RULE_MIN_MS..MAX_MS) and checks the rule against the current preset.
 */
export const StandingRuleSchema = z.object({
  schemaVersion: z.literal(1), pairId: id,
  supportModes: z.array(SupportModeSchema).refine(v => new Set(v).size === v.length, 'Duplicate support modes'),
  availability: z.array(AvailabilitySchema).refine(v => new Set(v).size === v.length, 'Duplicate availability'),
  purpose: z.enum(STANDING_RULE_PURPOSES), version: z.number().int().nonnegative(), expiresAt: time,
}).strict().refine(r => r.supportModes.length + r.availability.length > 0, 'A rule needs at least one category');
