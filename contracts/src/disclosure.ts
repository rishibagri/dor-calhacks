/**
 * Deterministic disclosure + delivery logic shared by the UI preview, SpacetimeDB reducers and
 * the coordination worker, so all three compute the same answer (FLOWS.md F3, F5, F7).
 *
 * Status: CS draft of Cyber-owned semantics (D016). Pure functions only: no I/O, no clock reads,
 * no identity. A `true` result is necessary, never sufficient: reducers still verify caller
 * identity, pair membership and current versions from authoritative state.
 */
import { z } from 'zod';
import {
  AvailabilitySchema, SupportModeSchema,
  type ApprovedSignal, type Availability, type Nudge, type RecipientPresetAssignment,
  type RelationshipPreset, type SharingCategory, type SupportMode,
} from './schemas.js';
import type { PolicyReason } from './ports.js';

/** Owner-only output of the private agent (C1). Local; never stored in shared state. */
export const SignalCandidateSchema = z.object({
  supportMode: SupportModeSchema.optional(),
  availability: AvailabilitySchema.optional(),
}).strict();
export type SignalCandidate = z.infer<typeof SignalCandidateSchema>;

export const SIGNAL_LIFETIME_MS = 24 * 60 * 60 * 1000;

const FIELD_CATEGORY = { supportMode: 'support_preference', availability: 'coarse_availability' } as const;
type CandidateField = keyof typeof FIELD_CATEGORY;
const FIELDS = Object.keys(FIELD_CATEGORY) as CandidateField[];

const SUPPORT_PHRASE: Record<SupportMode, string> = {
  short_call: 'would welcome a short call',
  encouraging_note: 'would welcome a kind note',
  shared_activity: 'would welcome doing something together',
};
const AVAILABILITY_PHRASE: Record<Availability, string> = {
  today: 'today works',
  this_week: 'this week works',
  no_preference: 'timing is flexible',
};

/** Exact recipient-visible copy, keyed by the only template IDs a nudge may carry (C5). */
export const NUDGE_TEMPLATE_COPY: Record<Nudge['templateId'], string> = {
  offer_short_call: 'Someone you are connected with would welcome a short call. Want to offer one?',
  offer_note: 'Someone you are connected with would welcome a kind note. Want to send one?',
  offer_shared_activity: 'Someone you are connected with would welcome a shared activity. Want to suggest one?',
};
const TEMPLATE_FOR_MODE: Record<SupportMode, Nudge['templateId']> = {
  short_call: 'offer_short_call', encouraging_note: 'offer_note', shared_activity: 'offer_shared_activity',
};

export interface PreviewInput {
  candidate: unknown;
  ownerId: string;
  recipientId: string;
  pairId: string;
  pairStatus: 'pending' | 'accepted' | 'unlinked';
  preset: RelationshipPreset | null;
  assignment: RecipientPresetAssignment | null;
  now: Date;
}

export type DisclosurePreview =
  | { kind: 'denied'; reason: PolicyReason }
  | { kind: 'nothing_to_share' }
  | {
      kind: 'shareable';
      /** Exactly the fields an approval would write; blocked fields are omitted, never substituted. */
      payload: SignalCandidate;
      shared: SharingCategory[];
      blocked: SharingCategory[];
      /** Owner-facing meaning of what the named recipient may infer. */
      ownerSentence: string;
      /** Literal recipient copy if this ends in a nudge, or null when no template applies. */
      recipientCopy: string | null;
    };

/**
 * F3 preview. Same function runs on the owner's device (for display) and inside approve_signal
 * (for enforcement). Order of checks fixes which reason the owner sees.
 */
export function previewDisclosure(input: PreviewInput, recipientName: string): DisclosurePreview {
  const deny = (reason: PolicyReason): DisclosurePreview => ({ kind: 'denied', reason });
  const parsed = SignalCandidateSchema.safeParse(input.candidate);
  if (!parsed.success) return deny('invalid_schema');
  if (input.pairStatus === 'unlinked') return deny('unlinked');
  if (input.pairStatus !== 'accepted') return deny('no_consent');
  const { preset, assignment } = input;
  if (!preset || !assignment) return deny('no_consent');
  if (assignment.ownerId !== input.ownerId || assignment.recipientId !== input.recipientId ||
    assignment.pairId !== input.pairId || preset.ownerId !== input.ownerId) return deny('wrong_recipient');
  if (assignment.presetId !== preset.policyId) return deny('stale_policy');
  if (preset.revokedAt !== null) return deny('revoked');
  if (Date.parse(preset.expiresAt) <= input.now.getTime()) return deny('expired');

  const candidate = parsed.data;
  const present = FIELDS.filter(f => candidate[f] !== undefined);
  if (present.length === 0) return { kind: 'nothing_to_share' };
  const allowed = present.filter(f => preset.allowedCategories.includes(FIELD_CATEGORY[f]));
  const blocked = present.filter(f => !allowed.includes(f)).map(f => FIELD_CATEGORY[f]);
  if (allowed.length === 0) return deny('blocked_category');

  const payload: SignalCandidate = {};
  if (allowed.includes('supportMode')) payload.supportMode = candidate.supportMode;
  if (allowed.includes('availability')) payload.availability = candidate.availability;
  return {
    kind: 'shareable', payload, blocked,
    shared: allowed.map(f => FIELD_CATEGORY[f]),
    ownerSentence: ownerSentence(recipientName, payload),
    recipientCopy: payload.supportMode ? NUDGE_TEMPLATE_COPY[TEMPLATE_FOR_MODE[payload.supportMode]] : null,
  };
}

function ownerSentence(name: string, p: SignalCandidate): string {
  const parts = [
    p.supportMode ? `you ${SUPPORT_PHRASE[p.supportMode]}` : null,
    p.availability ? AVAILABILITY_PHRASE[p.availability] : null,
  ].filter((x): x is string => x !== null);
  const caveat = p.supportMode
    ? 'A nudge can itself suggest you might want support.'
    : 'Availability alone produces no nudge, but it still reaches the coordinator.';
  return `${name} may learn that ${parts.join(', and ')}. ${caveat}`;
}

/** F4: the approval payload is the preview payload; no other field may change between them. */
export function sameApprovedPayload(preview: SignalCandidate, signal: Pick<ApprovedSignal, 'supportMode' | 'availability'>): boolean {
  return preview.supportMode === signal.supportMode && preview.availability === signal.availability;
}

/** Recipient-owned delivery preferences (D017, D018). Defaults deny. */
export interface RecipientDelivery {
  optedIn: boolean;
  /** Minutes after local midnight; start > end wraps midnight. Null disables quiet hours. */
  quietStartMinute: number | null;
  quietEndMinute: number | null;
  /** Recipient's UTC offset captured when quiet hours were set (D018 notes DST drift). */
  utcOffsetMinutes: number;
}
export const DEFAULT_RECIPIENT_DELIVERY: RecipientDelivery = {
  optedIn: false, quietStartMinute: 22 * 60, quietEndMinute: 8 * 60, utcOffsetMinutes: 0,
};
export const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type DeliveryDecision =
  | { deliver: true; reason: 'ok' }
  | { deliver: false; reason: 'not_opted_in' | 'quiet_hours' | 'cooldown' };

/** F5/F7: whether a nudge may be delivered now. Checked at coordination and again at commit. */
export function nudgeDelivery(pref: RecipientDelivery, lastNudgeAt: Date | null, now: Date): DeliveryDecision {
  if (!pref.optedIn) return { deliver: false, reason: 'not_opted_in' };
  if (lastNudgeAt && now.getTime() - lastNudgeAt.getTime() < NUDGE_COOLDOWN_MS) return { deliver: false, reason: 'cooldown' };
  if (inQuietHours(pref, now)) return { deliver: false, reason: 'quiet_hours' };
  return { deliver: true, reason: 'ok' };
}

function inQuietHours(pref: RecipientDelivery, now: Date): boolean {
  const { quietStartMinute: start, quietEndMinute: end } = pref;
  if (start === null || end === null || start === end) return false;
  const local = (((now.getUTCHours() * 60 + now.getUTCMinutes() + pref.utcOffsetMinutes) % 1440) + 1440) % 1440;
  return start < end ? local >= start && local < end : local >= start || local < end;
}

/** F6: the coordinator's only output vocabulary. Null means "no suggestion". */
export function templateForSignal(signal: Pick<ApprovedSignal, 'supportMode'>): Nudge['templateId'] | null {
  return signal.supportMode ? TEMPLATE_FOR_MODE[signal.supportMode] : null;
}
