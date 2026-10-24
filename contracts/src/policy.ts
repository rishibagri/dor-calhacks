/**
 * C6 deterministic disclosure guards (Cyber-owned). PRODUCTION CODE, not a fake.
 *
 * Runtime-dependency-free (no Zod, no Date.now, no I/O) so the same rules run inside
 * authoritative SpacetimeDB reducers/views, Next.js routes and the worker. Import from
 * `@kinetic/contracts/policy` inside the SpacetimeDB module to keep Zod out of its bundle.
 *
 * These functions decide; they do not authenticate or load state. Callers MUST pass:
 *  - `callerId`: the authenticated caller (SpacetimeDB `ctx.sender`), never a client-supplied ID;
 *  - snapshots read from authoritative server state in the same transaction as the write;
 *  - `nowMs` from the authoritative clock (`ctx.timestamp`), never the client.
 * Quiz answers, LocalConnectionProfile and model output are not inputs and never authorize.
 * Every check is default-deny: a missing record denies.
 */
import { AVAILABILITIES, DISCLOSURE_PURPOSE, NUDGE_TEMPLATE_IDS, SUPPORT_MODES } from './enums.js';
export * from './enums.js';
import type { PolicyReason } from './ports.js';
import type { SharingCategory, SupportMode } from './schemas.js';

/** Default item-consent lifetime (PRIVACY.md). Approvals are clamped to min(now + this, preset expiry). */
export const SIGNAL_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * Version of the disclosure notice/preview wording the owner consents to (PRIVACY.md honest copy).
 * Bump when that wording changes: every active signal approved under an older notice becomes stale.
 * Editing an item is revoke + new approval; signals are never updated in place.
 */
export const DISCLOSURE_CONSENT_VERSION = 1;

const MAX_ID = 128;

export type DenyReason = Exclude<PolicyReason, 'ok'>;
export type Deny = { allowed: false; reason: DenyReason };
export type Allow = { allowed: true; reason: 'ok' };
export type PolicyDecision = Allow | Deny;

/** Authoritative pair record. IDs are opaque strings (e.g. Identity hex). */
export interface PairState {
  pairId: string;
  memberA: string;
  memberB: string | null;
  status: string; // only 'accepted' passes
}
/** The owner's assignment of a confirmed preset to one named recipient in one pair. */
export interface AssignmentState {
  ownerId: string;
  recipientId: string;
  pairId: string;
  presetId: string;
  assignmentVersion: number;
}
/** The owner-confirmed relationship preset the assignment points at. */
export interface PresetState {
  policyId: string;
  ownerId: string;
  allowedCategories: readonly string[];
  version: number;
  expiresAtMs: number;
  revokedAtMs: number | null;
}
/** Everything a guard needs, read from authoritative state. Missing record = null = deny. */
export interface PolicySnapshot {
  nowMs: number;
  pair: PairState | null;
  assignment: AssignmentState | null;
  preset: PresetState | null;
}

/** ApprovedSignal v2 as persisted, with times as epoch ms and revocation state. */
export interface StoredSignal {
  signalId: string;
  pairId: string;
  senderId: string;
  recipientId: string;
  purpose: string;
  supportMode?: string;
  availability?: string;
  consentVersion: number;
  recipientPolicyId: string;
  recipientPolicyVersion: number;
  presetAssignmentVersion: number;
  expiresAtMs: number;
  revokedAtMs: number | null;
}

const deny = (reason: DenyReason): Deny => ({ allowed: false, reason });
const ALLOW: Allow = { allowed: true, reason: 'ok' };

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID;
const isVersion = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const isIn = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

/** Categories a payload discloses. Pure field mapping; never adds or strips fields. */
export function categoriesOf(p: { supportMode?: string; availability?: string }): SharingCategory[] {
  const out: SharingCategory[] = [];
  if (p.supportMode !== undefined) out.push('support_preference');
  if (p.availability !== undefined) out.push('coarse_availability');
  return out;
}

/** Strict payload enum check. Undefined means "not disclosed"; at least one category required. */
function payloadShapeOk(p: { supportMode?: unknown; availability?: unknown }): boolean {
  if (p.supportMode === undefined && p.availability === undefined) return false;
  if (p.supportMode !== undefined && !isIn(SUPPORT_MODES, p.supportMode)) return false;
  if (p.availability !== undefined && !isIn(AVAILABILITIES, p.availability)) return false;
  return true;
}

export interface PayloadRevisionInput {
  pairId: string;
  recipientId: string;
  supportMode?: string;
  availability?: string;
  recipientPolicyVersion: number;
  presetAssignmentVersion: number;
  consentVersion: number;
}

/**
 * Canonical u32 revision of the exact recipient-visible payload the owner previewed.
 * The preview route returns it; approve_signal recomputes it from its own arguments and
 * authoritative recipient, so approving anything other than what was shown is rejected.
 * FNV-1a 32-bit: an integrity binding against stale/drifted previews, NOT an anti-forgery MAC.
 * The authenticated owner is the authority; every other condition is checked independently.
 */
export function payloadRevision(p: PayloadRevisionInput): number {
  const canonical = ['kinetic-payload-v1', p.pairId, p.recipientId, DISCLOSURE_PURPOSE,
    p.supportMode ?? '-', p.availability ?? '-', p.recipientPolicyVersion,
    p.presetAssignmentVersion, p.consentVersion].join('\u001f');
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Shared relationship/preset checks for an owner → recipient disclosure.
 * Ordering matters: membership is checked first so non-members always get `wrong_recipient`
 * (reducers map it to not_found) and cannot probe pair state.
 */
function checkStanding(
  ownerId: string, s: PolicySnapshot, bound: { recipientPolicyVersion: number; presetAssignmentVersion: number },
): (Allow & { recipientId: string; preset: PresetState }) | Deny {
  const { pair, assignment, preset } = s;
  if (!pair || (pair.memberA !== ownerId && pair.memberB !== ownerId)) return deny('wrong_recipient');
  const recipientId = pair.memberA === ownerId ? pair.memberB : pair.memberA;
  if (pair.status !== 'accepted' || !recipientId || recipientId === ownerId) return deny('unlinked');
  // No confirmed preset assigned to this named recipient = no permission ceiling at all.
  if (!assignment || !preset) return deny('no_consent');
  if (assignment.ownerId !== ownerId || assignment.pairId !== pair.pairId ||
    assignment.recipientId !== recipientId) return deny('wrong_recipient');
  if (preset.ownerId !== ownerId || preset.policyId !== assignment.presetId) return deny('no_consent');
  if (preset.revokedAtMs !== null) return deny('revoked');
  if (assignment.assignmentVersion !== bound.presetAssignmentVersion ||
    preset.version !== bound.recipientPolicyVersion) return deny('stale_policy');
  return { ...ALLOW, recipientId, preset };
}

export interface ApprovalRequest {
  /** Authenticated caller (ctx.sender). The sender is always the caller. */
  callerId: string;
  pairId: string;
  supportMode?: string;
  availability?: string;
  payloadRevision: number;
  recipientPolicyVersion: number;
  presetAssignmentVersion: number;
  consentVersion: number;
  clientRequestId: string;
}

export type ApprovalDecision =
  | (Allow & { recipientId: string; recipientPolicyId: string; expiresAtMs: number; categories: SharingCategory[] })
  | Deny;

/**
 * Guard for creating an ApprovedSignal (approve_signal reducer / approve route).
 * Effective disclosure = accepted relationship ∩ assigned confirmed preset ∩ exact item
 * approval ∩ purpose ∩ unexpired/unrevoked. A blocked category denies the whole request:
 * fields are never silently stripped or substituted.
 */
export function guardApproval(req: ApprovalRequest, s: PolicySnapshot): ApprovalDecision {
  if (!isId(req.callerId) || !isId(req.pairId) || !isId(req.clientRequestId)) return deny('invalid_schema');
  if (!payloadShapeOk(req)) return deny('invalid_schema');
  if (!isVersion(req.recipientPolicyVersion) || !isVersion(req.presetAssignmentVersion) ||
    !isVersion(req.consentVersion) || !Number.isSafeInteger(req.payloadRevision) ||
    req.payloadRevision < 0 || !Number.isFinite(s.nowMs)) return deny('invalid_schema');
  if (s.pair && s.pair.pairId !== req.pairId) return deny('wrong_recipient');

  const standing = checkStanding(req.callerId, s, req);
  if (!standing.allowed) return standing;
  const { recipientId, preset } = standing;
  if (preset.expiresAtMs <= s.nowMs) return deny('expired');

  const categories = categoriesOf(req);
  if (categories.some(c => !preset.allowedCategories.includes(c))) return deny('blocked_category');
  if (req.consentVersion !== DISCLOSURE_CONSENT_VERSION) return deny('stale_policy');
  const expected = payloadRevision({
    pairId: req.pairId, recipientId, supportMode: req.supportMode, availability: req.availability,
    recipientPolicyVersion: req.recipientPolicyVersion, presetAssignmentVersion: req.presetAssignmentVersion,
    consentVersion: req.consentVersion,
  });
  if (req.payloadRevision !== expected) return deny('no_consent');

  return {
    ...ALLOW, recipientId, recipientPolicyId: preset.policyId, categories,
    expiresAtMs: Math.min(s.nowMs + SIGNAL_LIFETIME_MS, preset.expiresAtMs),
  };
}

/**
 * Non-temporal standing of a stored signal: not revoked, relationship still accepted,
 * same assignment/preset versions, categories still allowed, current consent notice.
 * Use directly ONLY where no trustworthy clock exists (SpacetimeDB views have no timestamp);
 * everywhere else call guardSignalUse.
 */
export function guardSignalStanding(sig: StoredSignal, s: Omit<PolicySnapshot, 'nowMs'>,
  expectedRecipientId?: string): PolicyDecision {
  if (!isId(sig.signalId) || !isId(sig.senderId) || !isId(sig.recipientId) ||
    sig.purpose !== DISCLOSURE_PURPOSE || !payloadShapeOk(sig)) return deny('invalid_schema');
  if (expectedRecipientId !== undefined && expectedRecipientId !== sig.recipientId) return deny('wrong_recipient');
  if (sig.revokedAtMs !== null) return deny('revoked');
  if (s.pair && s.pair.pairId !== sig.pairId) return deny('wrong_recipient');
  const standing = checkStanding(sig.senderId, { ...s, nowMs: 0 }, sig);
  if (!standing.allowed) return standing;
  if (standing.recipientId !== sig.recipientId) return deny('wrong_recipient');
  if (standing.preset.policyId !== sig.recipientPolicyId) return deny('stale_policy');
  if (categoriesOf(sig).some(c => !standing.preset.allowedCategories.includes(c))) return deny('blocked_category');
  if (sig.consentVersion !== DISCLOSURE_CONSENT_VERSION) return deny('stale_policy');
  return ALLOW;
}

/**
 * Guard for every use of a stored signal: before each coordination round, before
 * committing a nudge, and before delivery. Revalidates against CURRENT state.
 */
export function guardSignalUse(sig: StoredSignal, s: PolicySnapshot, expectedRecipientId?: string): PolicyDecision {
  if (!Number.isFinite(s.nowMs)) return deny('invalid_schema');
  const standing = guardSignalStanding(sig, s, expectedRecipientId);
  if (!standing.allowed) return standing;
  if (sig.expiresAtMs <= s.nowMs || (s.preset && s.preset.expiresAtMs <= s.nowMs)) return deny('expired');
  return ALLOW;
}

const TEMPLATE_MODE: Record<(typeof NUDGE_TEMPLATE_IDS)[number], SupportMode> = {
  offer_short_call: 'short_call', offer_note: 'encouraging_note', offer_shared_activity: 'shared_activity',
};

export interface NudgeCommitRequest {
  pairId: string;
  recipientId: string;
  templateId: string;
  sourceSignalIds: readonly string[];
  sourceConsentVersions: readonly number[];
}
export interface NudgeSource { signal: StoredSignal; snapshot: PolicySnapshot }
export type NudgeDecision = (Allow & { expiresAtMs: number }) | Deny;

/**
 * Guard for committing a coordinator-proposed nudge. Every source must pass guardSignalUse
 * for this pair and recipient; the template's support mode must be one the owner approved
 * (a template never implies a mode nobody approved); expiry is clamped to the earliest source.
 * Model/coordinator output is input to this check, never authority.
 */
export function guardNudgeCommit(req: NudgeCommitRequest, sources: ReadonlyMap<string, NudgeSource>): NudgeDecision {
  if (!isId(req.pairId) || !isId(req.recipientId) || !isIn(NUDGE_TEMPLATE_IDS, req.templateId)) return deny('invalid_schema');
  const ids = req.sourceSignalIds;
  if (ids.length === 0 || ids.length !== req.sourceConsentVersions.length ||
    new Set(ids).size !== ids.length) return deny('invalid_schema');
  let expiresAtMs = Infinity;
  let modeApproved = false;
  for (let i = 0; i < ids.length; i++) {
    const src = sources.get(ids[i]);
    if (!src) return deny('no_consent');
    const { signal, snapshot } = src;
    if (signal.signalId !== ids[i] || signal.pairId !== req.pairId) return deny('wrong_recipient');
    if (signal.consentVersion !== req.sourceConsentVersions[i]) return deny('stale_policy');
    const d = guardSignalUse(signal, snapshot, req.recipientId);
    if (!d.allowed) return d;
    if (signal.supportMode === TEMPLATE_MODE[req.templateId]) modeApproved = true;
    expiresAtMs = Math.min(expiresAtMs, signal.expiresAtMs);
  }
  if (!modeApproved) return deny('blocked_category');
  return { ...ALLOW, expiresAtMs };
}

/** Reducer/API error code for a denial (API.md). Messages must carry only the reason code. */
export function policyErrorCode(reason: DenyReason): 'invalid' | 'not_found' | 'unauthorized' | 'stale' {
  switch (reason) {
    case 'invalid_schema': return 'invalid';
    case 'wrong_recipient': return 'not_found'; // no existence leak to non-members
    case 'no_consent':
    case 'blocked_category': return 'unauthorized';
    case 'unlinked': return 'invalid';
    case 'expired':
    case 'revoked':
    case 'stale_policy': return 'stale';
  }
}
