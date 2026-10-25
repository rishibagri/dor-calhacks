/**
 * DS rule-based matching baseline (ACCEPTANCE.md "simple rule-based baseline").
 * Pure and deterministic: no provider calls, no I/O, no clock reads.
 *
 * - buildPreview: owner-only AI candidate → fields the owner may be asked to approve for one
 *   named recipient. It can only narrow. Quiz draft categories are deliberately not an input,
 *   so no quiz answer can activate or broaden sharing; only the confirmed preset is a ceiling.
 * - matchSignal: approved envelope (C3) + recipient ACK (C4) → fixed template (C5) or no nudge.
 *   The disclosure decision is an input from DisclosurePolicyPort (Cyber); this module never
 *   grants consent and treats any policy denial as final.
 */
import { AgentAckSchema, ApprovedSignalSchema, AvailabilitySchema, NudgeSchema, SupportModeSchema } from '@dor/contracts';
import type {
  AgentAck, ApprovedSignal, Availability, Nudge, PolicyResult, RecipientPresetAssignment, RelationshipPreset, SupportMode,
} from '@dor/contracts';

export const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const TEMPLATE_FOR: Record<SupportMode, Nudge['templateId']> = {
  short_call: 'offer_short_call',
  encouraging_note: 'offer_note',
  shared_activity: 'offer_shared_activity',
};

export interface PreviewFields { supportMode?: SupportMode; availability?: Availability }
export type NoSignalReason = 'no_assignment' | 'no_candidate' | 'no_allowed_category';
export type PreviewResult =
  | { kind: 'preview'; fields: PreviewFields }
  | { kind: 'no_signal'; reason: NoSignalReason };

export interface PreviewInput {
  /** Owner-only private candidate from AI. Untrusted: only enumerated contract values are read. */
  candidate: unknown;
  preset: RelationshipPreset;
  /** Assignment of `preset` to the named recipient, or null when none exists. */
  assignment: RecipientPresetAssignment | null;
  recipientId: string;
  // No quiz input: Q1 "space" (LocalQuizExtras.prefersSpace) only leaves support out of the preset drafts (CS 427cd3f,
  // core3-audit.md item 3). It neither suppresses a later entry nor grants consent; "space" for one moment is the
  // per-entry assessment (wants_space → no_action) in the decision loop, before any candidate reaches this function.
}

/**
 * Builds a new preview before approval. Dropping a blocked category here is allowed because
 * nothing has been approved yet; an already approved envelope is never edited (ONBOARDING_SHARING.md).
 */
export function buildPreview(input: PreviewInput): PreviewResult {
  const noSignal = (reason: NoSignalReason): PreviewResult => ({ kind: 'no_signal', reason });
  const a = input.assignment;
  if (!a || a.recipientId !== input.recipientId || a.ownerId !== input.preset.ownerId || a.presetId !== input.preset.policyId)
    return noSignal('no_assignment');
  if (typeof input.candidate !== 'object' || input.candidate === null) return noSignal('no_candidate');
  const c = input.candidate as Record<string, unknown>;
  const mode = SupportModeSchema.safeParse(c.supportMode);
  const window = AvailabilitySchema.safeParse(c.availability);
  if (!mode.success && !window.success) return noSignal('no_candidate');
  const allowed = new Set(input.preset.allowedCategories);
  const fields: PreviewFields = {};
  if (mode.success && allowed.has('support_preference')) fields.supportMode = mode.data;
  if (window.success && allowed.has('coarse_availability')) fields.availability = window.data;
  if (fields.supportMode === undefined && fields.availability === undefined) return noSignal('no_allowed_category');
  return { kind: 'preview', fields };
}

export type NoNudgeReason =
  | Exclude<PolicyResult['reason'], 'ok'>
  | 'no_signal' | 'no_recipient_consent' | 'ack_mismatch' | 'recipient_declined'
  | 'incompatible_preferences' | 'quiet_hours' | 'cooldown';
export type MatchResult =
  | { outcome: 'nudge'; templateId: Nudge['templateId']; supportMode: SupportMode; availability?: Availability }
  | { outcome: 'no_nudge'; reason: NoNudgeReason };

export interface MatchInput {
  /** Submitted envelope, or null when no signal was produced. Re-parsed here as defense in depth. */
  signal: unknown;
  /** Result of DisclosurePolicyPort.check for this envelope and recipient; null when nothing was submitted. */
  policy: PolicyResult | null;
  /** Recipient agent ACK from the recipient's own approved preferences; null when they have not opted in. */
  ack: unknown;
  now: Date;
  inQuietHours: boolean;
  /** Last delivered nudge for this pair (UTC ISO), or null. */
  lastNudgeAt: string | null;
}

/** Coarse windows: no_preference is the identity, and today lies within this_week. */
export function intersectAvailability(a: Availability | undefined, b: Availability | undefined): Availability | undefined {
  if (a === undefined || b === undefined) return undefined;
  if (a === 'no_preference') return b;
  if (b === 'no_preference' || a === b) return a;
  return 'today';
}

/** Check order: signal exists → policy → recipient ACK → mode intersection → delivery timing. */
export function matchSignal(input: MatchInput): MatchResult {
  const none = (reason: NoNudgeReason): MatchResult => ({ outcome: 'no_nudge', reason });
  if (input.policy === null) return none('no_signal');
  if (!input.policy.allowed) return none(input.policy.reason as Exclude<PolicyResult['reason'], 'ok'>);
  const parsed = ApprovedSignalSchema.safeParse(input.signal);
  if (!parsed.success) return none('invalid_schema');
  const signal = parsed.data;
  if (input.ack === null || input.ack === undefined) return none('no_recipient_consent');
  const ackParsed = AgentAckSchema.safeParse(input.ack);
  if (!ackParsed.success) return none('invalid_schema');
  const ack = ackParsed.data;
  if (ack.signalId !== signal.signalId) return none('ack_mismatch');
  if (ack.decision === 'decline') return none('recipient_declined');
  if (signal.supportMode === undefined || ack.supportMode !== signal.supportMode) return none('incompatible_preferences');
  if (input.inQuietHours) return none('quiet_hours');
  if (input.lastNudgeAt !== null && input.now.getTime() - Date.parse(input.lastNudgeAt) < COOLDOWN_MS) return none('cooldown');
  const availability = intersectAvailability(signal.availability, ack.availability);
  return {
    outcome: 'nudge', templateId: TEMPLATE_FOR[signal.supportMode], supportMode: signal.supportMode,
    ...(availability !== undefined ? { availability } : {}),
  };
}

/** Contract Nudge for a match; expires at the earlier of the signal expiry and the 24h cooldown window. */
export function buildNudge(signal: ApprovedSignal, ack: AgentAck, match: Extract<MatchResult, { outcome: 'nudge' }>,
  opts: { id: string; now: Date }): Nudge {
  if (ack.signalId !== signal.signalId) throw new Error('ack does not belong to signal');
  const expiresAt = Math.min(Date.parse(signal.expiresAt), opts.now.getTime() + COOLDOWN_MS);
  return NudgeSchema.parse({
    schemaVersion: 1, id: opts.id, pairId: signal.pairId, recipientId: signal.recipientId,
    sourceSignalIds: [signal.signalId], sourceConsentVersions: [signal.consentVersion],
    templateId: match.templateId, createdAt: opts.now.toISOString(), expiresAt: new Date(expiresAt).toISOString(),
  });
}

const HOUR_MS = 3_600_000;

/** The recipient's own nudge row (`my_nudges`), mirroring Cyber's D043 projection in spacetimedb/src/views.ts. */
/** D056 adds `hook`: the sender's talking point, null when none (a nudge built from pure fixtures carries none). */
export interface RecipientNudgeRow { id: string; pairId: string; templateId: Nudge['templateId']; visibleUntil: string; hook: string | null }

/**
 * Projects an internal nudge to exactly what its recipient can subscribe to under D043: no creation time, exact
 * expiry, source signal ids or consent versions, and `visibleUntil` = the expiry rounded up to the hour. The rounding
 * hides the approval minute, not the hour: expiry is approval + SIGNAL_LIFETIME_MS whenever that is within one cooldown.
 */
export function recipientNudgeRow(n: Nudge): RecipientNudgeRow {
  const visibleUntil = Math.ceil(Date.parse(n.expiresAt) / HOUR_MS) * HOUR_MS;
  return { id: n.id, pairId: n.pairId, templateId: n.templateId, visibleUntil: new Date(visibleUntil).toISOString(), hook: null };
}
