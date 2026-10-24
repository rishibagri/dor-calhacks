/**
 * Device-only F3 preview → F4 approval input (FLOWS.md, src/privacy/README.md "CS: device preview → approve").
 * Pure: the candidate never leaves this module except as the exact `payload` the owner approves.
 * A `shareable` preview is necessary, never sufficient: approve_signal re-runs guardApproval on authoritative rows.
 */
import {
  DISCLOSURE_CONSENT_VERSION, payloadRevision, previewDisclosure,
  type DisclosurePreview, type RecipientPresetAssignment, type RelationshipPreset, type SignalCandidate,
} from '@dor/contracts';
import type { PairView, SharedStatePort } from '@/lib/backend/ports';

export type ApprovalInput = Parameters<SharedStatePort['approveSignal']>[0];
/** Everything approve_signal needs except the request ID, which is bound to the payload at tap time. */
export type ApprovalDraft = Omit<ApprovalInput, 'clientRequestId'>;

export interface ShareRecipient {
  pairId: string;
  name: string;
  counterpartHex: string;
  /** True when the label is a generated "Connection N" because the connection has no display name. */
  unnamed: boolean;
}

/**
 * Distinct owner-facing labels so the owner can always tell connections apart. Stable order: pair creation time,
 * then pair id. Unnamed → "Connection 1", "Connection 2", …; a repeated display name gets " (2)", " (3)", ….
 */
function labelPairs(pairs: readonly PairView[]): Map<string, { name: string; unnamed: boolean }> {
  const ordered = [...pairs].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.pairId.localeCompare(b.pairId));
  const seen = new Map<string, number>();
  let unnamedCount = 0;
  const labels = new Map<string, { name: string; unnamed: boolean }>();
  for (const p of ordered) {
    const base = p.counterpartDisplayName?.trim() ?? '';
    if (base === '') {
      unnamedCount += 1;
      labels.set(p.pairId, { name: `Connection ${unnamedCount}`, unnamed: true });
      continue;
    }
    const key = base.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    labels.set(p.pairId, { name: n === 1 ? base : `${base} (${n})`, unnamed: false });
  }
  return labels;
}

/** Accepted pairs with a known counterpart: the only people a signal could be approved for. */
export function shareRecipients(pairs: readonly PairView[]): ShareRecipient[] {
  const eligible = pairs.filter((p) => p.status === 'accepted' && p.counterpartIdentityHex);
  const labels = labelPairs(eligible);
  return eligible.map((p) => ({
    pairId: p.pairId,
    counterpartHex: p.counterpartIdentityHex as string,
    ...(labels.get(p.pairId) as { name: string; unnamed: boolean }),
  }));
}

export interface PrepareShareInput {
  candidate: SignalCandidate | null;
  ownerHex: string;
  pair: PairView;
  presets: readonly RelationshipPreset[];
  assignments: readonly RecipientPresetAssignment[];
  now: Date;
}

export type PreparedShare =
  | { kind: 'not_ready'; preview: Exclude<DisclosurePreview, { kind: 'shareable' }> }
  | { kind: 'ready'; preview: Extract<DisclosurePreview, { kind: 'shareable' }>; approval: ApprovalDraft };

/** The caller's own assignment to this pair's counterpart, and the preset it points at. */
function standing(input: PrepareShareInput): { preset: RelationshipPreset | null; assignment: RecipientPresetAssignment | null } {
  const assignment = input.assignments.find((a) =>
    a.pairId === input.pair.pairId && a.ownerId === input.ownerHex && a.recipientId === input.pair.counterpartIdentityHex) ?? null;
  const preset = assignment ? input.presets.find((p) => p.policyId === assignment.presetId) ?? null : null;
  return { preset, assignment };
}

export function prepareShare(input: PrepareShareInput, recipientName: string): PreparedShare {
  if (input.candidate === null) return { kind: 'not_ready', preview: { kind: 'nothing_to_share' } };
  const { preset, assignment } = standing(input);
  const preview = previewDisclosure({
    candidate: input.candidate, ownerId: input.ownerHex, recipientId: input.pair.counterpartIdentityHex ?? '',
    pairId: input.pair.pairId, pairStatus: input.pair.status, preset, assignment, now: input.now,
  }, recipientName);
  if (preview.kind !== 'shareable' || !preset || !assignment || !input.pair.counterpartIdentityHex) {
    return { kind: 'not_ready', preview: preview.kind === 'shareable' ? { kind: 'denied', reason: 'no_consent' } : preview };
  }
  const versions = {
    recipientPolicyVersion: preset.version,
    presetAssignmentVersion: assignment.assignmentVersion,
    consentVersion: DISCLOSURE_CONSENT_VERSION,
  };
  const approval: ApprovalDraft = {
    pairId: input.pair.pairId,
    ...preview.payload,
    ...versions,
    payloadRevision: payloadRevision({
      pairId: input.pair.pairId, recipientId: input.pair.counterpartIdentityHex, ...preview.payload, ...versions,
    }),
  };
  return { kind: 'ready', preview, approval };
}

const DENIAL_COPY: Record<string, string> = {
  no_consent: 'No preset is assigned to this person yet, so nothing can be shared. Assign one in Connections.',
  blocked_category: 'Your preset for this person does not allow these details.',
  expired: 'Your preset for this person has expired. Renew it in Connections.',
  revoked: 'Your preset for this person was revoked.',
  unlinked: 'You are no longer connected with this person.',
  stale_policy: 'Your settings changed. Review again.',
  wrong_recipient: 'This person is not one of your connections.',
  invalid_schema: 'This suggestion could not be read, so nothing can be shared.',
};

export function describeNotReady(preview: PreparedShare & { kind: 'not_ready' }): string {
  if (preview.preview.kind === 'nothing_to_share') return 'Nothing in this reflection suggests anything to share.';
  return DENIAL_COPY[preview.preview.reason] ?? 'Sharing is not allowed for this person right now.';
}

export interface RequestIdSlot { key: string; id: string }

/**
 * Request ID for this approval: reused only while the pair and payloadRevision are unchanged (a retry is then
 * idempotent), and fresh whenever either changes, e.g. preset versions moved while the review was open.
 */
export function requestIdFor(draft: ApprovalDraft, prev: RequestIdSlot | null, mint: () => string = () => crypto.randomUUID()): RequestIdSlot {
  const key = `${draft.pairId}:${draft.payloadRevision}`;
  return prev?.key === key ? prev : { key, id: mint() };
}

export type SignalStatus = 'active' | 'revoked' | 'expired';

/** Display status of one of the caller's own approvals; the server re-checks standing on every use. */
export function signalStatus(signal: { revokedAt: string | null; expiresAt: string }, nowMs: number): SignalStatus {
  if (signal.revokedAt !== null) return 'revoked';
  return Date.parse(signal.expiresAt) > nowMs ? 'active' : 'expired';
}
