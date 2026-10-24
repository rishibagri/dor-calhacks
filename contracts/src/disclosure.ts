/**
 * Device-side F3 preview (FLOWS.md) and recipient copy. The decision itself is the Cyber-owned
 * `evaluateDisclosure` in policy.ts (D016, D020, D026): this file only parses the untrusted
 * candidate with Zod and renders owner/recipient wording, so preview and reducers cannot drift.
 * Delivery (`nudgeDelivery`), `templateForSignal`, `matchesPreviewPayload` and SIGNAL_LIFETIME_MS live
 * in policy.ts (zod-free, reducer-safe) and are re-exported from `@dor/contracts`.
 *
 * Pure: no I/O, no clock reads, no identity. A `shareable` result is necessary, never sufficient:
 * approve_signal re-runs the same evaluation on authoritative rows via `guardApproval`.
 */
import { z } from 'zod';
import {
  AvailabilitySchema, SupportModeSchema,
  type Availability, type Nudge, type RecipientPresetAssignment,
  type RelationshipPreset, type SharingCategory, type SupportMode,
} from './schemas.js';
import type { PolicyReason } from './ports.js';
import { evaluateDisclosure, templateForSignal } from './policy.js';

/** Owner-only output of the private agent (C1). Local; never stored in shared state. */
export const SignalCandidateSchema = z.object({
  supportMode: SupportModeSchema.optional(),
  availability: AvailabilitySchema.optional(),
}).strict();
export type SignalCandidate = z.infer<typeof SignalCandidateSchema>;

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
 * F3 preview on the owner's device (D016: no network call, no server learns a candidate existed).
 * approve_signal enforces the same `evaluateDisclosure` on authoritative rows via `guardApproval`.
 */
export function previewDisclosure(input: PreviewInput, recipientName: string): DisclosurePreview {
  const parsed = SignalCandidateSchema.safeParse(input.candidate);
  if (!parsed.success) return { kind: 'denied', reason: 'invalid_schema' };
  const { preset, assignment } = input;
  const ev = evaluateDisclosure({
    candidate: parsed.data, ownerId: input.ownerId, recipientId: input.recipientId, pairId: input.pairId,
    pairStatus: input.pairStatus, nowMs: input.now.getTime(),
    preset: preset && {
      policyId: preset.policyId, ownerId: preset.ownerId, allowedCategories: preset.allowedCategories,
      version: preset.version, expiresAtMs: Date.parse(preset.expiresAt),
      revokedAtMs: preset.revokedAt === null ? null : Date.parse(preset.revokedAt),
    },
    assignment: assignment && {
      ownerId: assignment.ownerId, recipientId: assignment.recipientId, pairId: assignment.pairId,
      presetId: assignment.presetId, assignmentVersion: assignment.assignmentVersion,
    },
  });
  if (ev.kind !== 'shareable') return ev;
  const template = templateForSignal(ev.payload);
  return {
    ...ev,
    ownerSentence: ownerSentence(recipientName, ev.payload),
    recipientCopy: template ? NUDGE_TEMPLATE_COPY[template] : null,
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
