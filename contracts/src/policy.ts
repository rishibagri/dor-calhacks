/**
 * C6 disclosure + delivery semantics (Cyber-owned, D020/D026). PRODUCTION CODE, not a fake.
 * The single policy implementation: the device preview (`previewDisclosure` in disclosure.ts),
 * SpacetimeDB reducers/views, Next.js routes and the worker all call into this file.
 *
 * Runtime-dependency-free (no Zod, no Date.now, no I/O) so the same rules run inside
 * authoritative SpacetimeDB reducers/views. Import from `@kinetic/contracts/policy` inside the
 * SpacetimeDB module to keep Zod out of its bundle.
 *
 * These functions decide; they do not authenticate or load state. Callers MUST pass:
 *  - `callerId`: the authenticated caller (SpacetimeDB `ctx.sender`), never a client-supplied ID;
 *  - snapshots read from authoritative server state in the same transaction as the write;
 *  - `nowMs` from the authoritative clock (`ctx.timestamp`), never the client.
 * Quiz answers, LocalConnectionProfile and model output are not inputs and never authorize.
 * Every check is default-deny: a missing record denies.
 */
import { AVAILABILITIES, DISCLOSURE_PURPOSE, SUPPORT_MODES } from './enums.js';
export * from './enums.js';
import type { PolicyReason } from './ports.js';
import type { ApprovedSignal, Nudge, SharingCategory, SupportMode } from './schemas.js';

/** Default item-consent lifetime (PRIVACY.md). Approvals are clamped to min(now + this, preset expiry). */
export const SIGNAL_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** At most one nudge per pair per 24h (D018). */
export const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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

/** Enum-only disclosure payload (the fields of SignalCandidate / ApprovedSignal). */
export interface DisclosurePayload {
  supportMode?: SupportMode;
  availability?: (typeof AVAILABILITIES)[number];
}

const deny = (reason: DenyReason): Deny => ({ allowed: false, reason });
const ALLOW: Allow = { allowed: true, reason: 'ok' };

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID;
const isVersion = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const isIn = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

const FIELD_CATEGORY = { supportMode: 'support_preference', availability: 'coarse_availability' } as const;
const FIELDS = ['supportMode', 'availability'] as const;

/** Categories a payload discloses. Pure field mapping; never adds or strips fields. */
export function categoriesOf(p: { supportMode?: string; availability?: string }): SharingCategory[] {
  return FIELDS.filter(f => p[f] !== undefined).map(f => FIELD_CATEGORY[f]);
}

/** Strict payload enum check. Undefined means "not disclosed"; at least one category required. */
function payloadShapeOk(p: { supportMode?: unknown; availability?: unknown }): p is DisclosurePayload {
  if (p.supportMode === undefined && p.availability === undefined) return false;
  if (p.supportMode !== undefined && !isIn(SUPPORT_MODES, p.supportMode)) return false;
  if (p.availability !== undefined && !isIn(AVAILABILITIES, p.availability)) return false;
  return true;
}

/**
 * F4: the approval payload is the preview payload; no other field may change between them.
 * (Distinct from `sameApprovedPayload` in policy-port.ts: full presented-vs-stored envelope comparison.)
 */
export function matchesPreviewPayload(preview: { supportMode?: string; availability?: string },
  signal: { supportMode?: string; availability?: string }): boolean {
  return preview.supportMode === signal.supportMode && preview.availability === signal.availability;
}

export interface DisclosureInput {
  /** Already shape-validated (Zod on device, payloadShapeOk in reducers). May be empty. */
  candidate: DisclosurePayload;
  ownerId: string;
  recipientId: string;
  pairId: string;
  pairStatus: string;
  preset: PresetState | null;
  assignment: AssignmentState | null;
  /** Authoritative clock. `null` only where no clock exists (SpacetimeDB views): skips preset expiry. */
  nowMs: number | null;
}
export type DisclosureEvaluation =
  | { kind: 'denied'; reason: DenyReason }
  | { kind: 'nothing_to_share' }
  | { kind: 'shareable'; payload: DisclosurePayload; shared: SharingCategory[]; blocked: SharingCategory[] };

/**
 * F3 core (FLOWS.md): effective disclosure = accepted relationship ∩ preset assigned to this named
 * recipient ∩ preset unrevoked/unexpired ∩ allowed categories. Blocked fields are omitted from the
 * payload, never substituted; a candidate wholly outside the preset is denied, never downgraded.
 * The check order fixes which reason the owner sees and is pinned by flows.test.mjs.
 */
export function evaluateDisclosure(i: DisclosureInput): DisclosureEvaluation {
  const no = (reason: DenyReason): DisclosureEvaluation => ({ kind: 'denied', reason });
  if (i.pairStatus === 'unlinked') return no('unlinked');
  if (i.pairStatus !== 'accepted') return no('no_consent');
  const { preset, assignment } = i;
  if (!preset || !assignment) return no('no_consent');
  if (assignment.ownerId !== i.ownerId || assignment.recipientId !== i.recipientId ||
    assignment.pairId !== i.pairId || preset.ownerId !== i.ownerId) return no('wrong_recipient');
  if (assignment.presetId !== preset.policyId) return no('stale_policy');
  if (preset.revokedAtMs !== null) return no('revoked');
  if (i.nowMs !== null && preset.expiresAtMs <= i.nowMs) return no('expired');

  const present = FIELDS.filter(f => i.candidate[f] !== undefined);
  if (present.length === 0) return { kind: 'nothing_to_share' };
  const allowed = present.filter(f => preset.allowedCategories.includes(FIELD_CATEGORY[f]));
  if (allowed.length === 0) return no('blocked_category');
  const payload: DisclosurePayload = {};
  if (allowed.includes('supportMode')) payload.supportMode = i.candidate.supportMode;
  if (allowed.includes('availability')) payload.availability = i.candidate.availability;
  return {
    kind: 'shareable', payload, shared: allowed.map(f => FIELD_CATEGORY[f]),
    blocked: present.filter(f => !allowed.includes(f)).map(f => FIELD_CATEGORY[f]),
  };
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
 * Canonical u32 revision of the exact recipient-visible payload the owner previewed on device.
 * approve_signal recomputes it from its own arguments and the authoritative recipient, so approving
 * anything other than what was shown (or under other versions) is rejected.
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

/** Membership first, so non-members always get `wrong_recipient` (→ not_found) and cannot probe. */
function counterpart(ownerId: string, pair: PairState | null): { recipientId: string | null } | Deny {
  if (!pair || (pair.memberA !== ownerId && pair.memberB !== ownerId)) return deny('wrong_recipient');
  const other = pair.memberA === ownerId ? pair.memberB : pair.memberA;
  return { recipientId: other && other !== ownerId ? other : null };
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
 * F4 guard (approve_signal). Re-runs the F3 evaluation on authoritative rows and requires the request
 * to be exactly the shareable preview payload: a request still carrying a blocked field is denied
 * (`blocked_category`), never silently stripped. Then binds versions, consent notice and revision.
 */
export function guardApproval(req: ApprovalRequest, s: PolicySnapshot): ApprovalDecision {
  if (!isId(req.callerId) || !isId(req.pairId) || !isId(req.clientRequestId)) return deny('invalid_schema');
  if (!payloadShapeOk(req)) return deny('invalid_schema');
  if (!isVersion(req.recipientPolicyVersion) || !isVersion(req.presetAssignmentVersion) ||
    !isVersion(req.consentVersion) || !Number.isSafeInteger(req.payloadRevision) ||
    req.payloadRevision < 0 || !Number.isFinite(s.nowMs)) return deny('invalid_schema');
  if (s.pair && s.pair.pairId !== req.pairId) return deny('wrong_recipient');

  const cp = counterpart(req.callerId, s.pair);
  if ('allowed' in cp) return cp;
  const candidate: DisclosurePayload = { supportMode: req.supportMode, availability: req.availability };
  const ev = evaluateDisclosure({
    candidate, ownerId: req.callerId, recipientId: cp.recipientId ?? '', pairId: req.pairId,
    pairStatus: cp.recipientId ? s.pair!.status : 'pending', preset: s.preset, assignment: s.assignment, nowMs: s.nowMs,
  });
  if (ev.kind === 'denied') return deny(ev.reason);
  if (ev.kind !== 'shareable' || !matchesPreviewPayload(ev.payload, candidate)) return deny('blocked_category');
  const { preset, assignment } = s as { preset: PresetState; assignment: AssignmentState };
  if (assignment.assignmentVersion !== req.presetAssignmentVersion ||
    preset.version !== req.recipientPolicyVersion) return deny('stale_policy');
  if (req.consentVersion !== DISCLOSURE_CONSENT_VERSION) return deny('stale_policy');
  const recipientId = cp.recipientId!;
  const expected = payloadRevision({
    pairId: req.pairId, recipientId, supportMode: req.supportMode, availability: req.availability,
    recipientPolicyVersion: req.recipientPolicyVersion, presetAssignmentVersion: req.presetAssignmentVersion,
    consentVersion: req.consentVersion,
  });
  if (req.payloadRevision !== expected) return deny('no_consent');
  return {
    ...ALLOW, recipientId, recipientPolicyId: preset.policyId, categories: ev.shared,
    expiresAtMs: Math.min(s.nowMs + SIGNAL_LIFETIME_MS, preset.expiresAtMs),
  };
}

/**
 * Non-temporal standing of a stored signal: not revoked, relationship still accepted, F3 evaluation of
 * its own payload still shareable with nothing blocked, same assignment/preset versions and policy,
 * current consent notice. Use directly ONLY where no trustworthy clock exists (SpacetimeDB views);
 * everywhere else call guardSignalUse.
 */
export function guardSignalStanding(sig: StoredSignal, s: Omit<PolicySnapshot, 'nowMs'>,
  expectedRecipientId?: string): PolicyDecision {
  return standing(sig, s, null, expectedRecipientId);
}

function standing(sig: StoredSignal, s: Omit<PolicySnapshot, 'nowMs'>, nowMs: number | null,
  expectedRecipientId?: string): PolicyDecision {
  if (!isId(sig.signalId) || !isId(sig.senderId) || !isId(sig.recipientId) ||
    sig.purpose !== DISCLOSURE_PURPOSE || !payloadShapeOk(sig)) return deny('invalid_schema');
  if (expectedRecipientId !== undefined && expectedRecipientId !== sig.recipientId) return deny('wrong_recipient');
  if (sig.revokedAtMs !== null) return deny('revoked');
  if (s.pair && s.pair.pairId !== sig.pairId) return deny('wrong_recipient');
  const cp = counterpart(sig.senderId, s.pair);
  if ('allowed' in cp) return cp;
  if (cp.recipientId !== null && cp.recipientId !== sig.recipientId) return deny('wrong_recipient');
  const payload: DisclosurePayload = { supportMode: sig.supportMode, availability: sig.availability };
  const ev = evaluateDisclosure({
    candidate: payload, ownerId: sig.senderId, recipientId: sig.recipientId, pairId: sig.pairId,
    pairStatus: cp.recipientId ? s.pair!.status : 'pending', preset: s.preset, assignment: s.assignment, nowMs,
  });
  if (ev.kind === 'denied') return deny(ev.reason);
  if (ev.kind !== 'shareable' || !matchesPreviewPayload(ev.payload, payload)) return deny('blocked_category');
  const { preset, assignment } = s as { preset: PresetState; assignment: AssignmentState };
  if (preset.policyId !== sig.recipientPolicyId || assignment.assignmentVersion !== sig.presetAssignmentVersion ||
    preset.version !== sig.recipientPolicyVersion) return deny('stale_policy');
  if (sig.consentVersion !== DISCLOSURE_CONSENT_VERSION) return deny('stale_policy');
  return ALLOW;
}

/**
 * Guard for every use of a stored signal: before each coordination round, before
 * committing a nudge, and before delivery. Revalidates against CURRENT state.
 */
export function guardSignalUse(sig: StoredSignal, s: PolicySnapshot, expectedRecipientId?: string): PolicyDecision {
  if (!Number.isFinite(s.nowMs)) return deny('invalid_schema');
  const d = standing(sig, s, s.nowMs, expectedRecipientId);
  if (!d.allowed) return d;
  if (sig.expiresAtMs <= s.nowMs) return deny('expired');
  return ALLOW;
}

// ---- F5 recipient delivery gate (D017, D018) ----

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

export type DeliveryDenyReason = 'not_opted_in' | 'quiet_hours' | 'cooldown';
export type DeliveryDecision =
  | { deliver: true; reason: 'ok' }
  | { deliver: false; reason: DeliveryDenyReason };

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

/** Strict validation for a recipient's own delivery settings (set_nudge_delivery reducer). */
export function validRecipientDelivery(p: RecipientDelivery): boolean {
  const minute = (m: number | null) => m === null || (Number.isInteger(m) && m >= 0 && m < 1440);
  return typeof p.optedIn === 'boolean' && minute(p.quietStartMinute) && minute(p.quietEndMinute) &&
    (p.quietStartMinute === null) === (p.quietEndMinute === null) &&
    Number.isInteger(p.utcOffsetMinutes) && p.utcOffsetMinutes >= -14 * 60 && p.utcOffsetMinutes <= 14 * 60;
}

// ---- F6/F7 templates and nudge commit ----

const TEMPLATE_FOR_MODE: Record<SupportMode, Nudge['templateId']> = {
  short_call: 'offer_short_call', encouraging_note: 'offer_note', shared_activity: 'offer_shared_activity',
};

/** F6: the coordinator's only output vocabulary. Null means "no suggestion" (availability-only, D020). */
export function templateForSignal(signal: Pick<ApprovedSignal, 'supportMode'> | { supportMode?: string }): Nudge['templateId'] | null {
  return isIn(SUPPORT_MODES, signal.supportMode) ? TEMPLATE_FOR_MODE[signal.supportMode] : null;
}

export interface NudgeCommitRequest {
  pairId: string;
  recipientId: string;
  templateId: string;
  sourceSignalIds: readonly string[];
  sourceConsentVersions: readonly number[];
}
export interface NudgeSource { signal: StoredSignal; snapshot: PolicySnapshot }
/** Recipient's current delivery row (null = never set = DEFAULT, i.e. not opted in) and last nudge in the pair. */
export interface DeliveryGate { pref: RecipientDelivery | null; lastNudgeAtMs: number | null; nowMs: number }
export type NudgeDecision =
  | (Allow & { expiresAtMs: number })
  | { allowed: false; reason: DenyReason | DeliveryDenyReason };

/**
 * F7 guard for committing a coordinator-proposed nudge. Every source must pass guardSignalUse for this
 * pair and recipient; the template must be `templateForSignal` of an approved source (availability-only
 * sources justify nothing); then the F5 gate (opt-in, cooldown, quiet hours) is rechecked at commit.
 * Expiry is clamped to the earliest source and to one cooldown window.
 * Model/coordinator output is input to this check, never authority.
 */
export function guardNudgeCommit(req: NudgeCommitRequest, sources: ReadonlyMap<string, NudgeSource>,
  gate: DeliveryGate): NudgeDecision {
  if (!isId(req.pairId) || !isId(req.recipientId) || !Number.isFinite(gate.nowMs)) return deny('invalid_schema');
  if (!isIn(Object.values(TEMPLATE_FOR_MODE), req.templateId)) return deny('invalid_schema');
  const ids = req.sourceSignalIds;
  if (ids.length === 0 || ids.length > 4 || ids.length !== req.sourceConsentVersions.length ||
    new Set(ids).size !== ids.length) return deny('invalid_schema');
  let expiresAtMs = gate.nowMs + NUDGE_COOLDOWN_MS;
  let templateApproved = false;
  for (let i = 0; i < ids.length; i++) {
    const src = sources.get(ids[i]);
    if (!src) return deny('no_consent');
    const { signal, snapshot } = src;
    if (signal.signalId !== ids[i] || signal.pairId !== req.pairId) return deny('wrong_recipient');
    if (signal.consentVersion !== req.sourceConsentVersions[i]) return deny('stale_policy');
    const d = guardSignalUse(signal, { ...snapshot, nowMs: gate.nowMs }, req.recipientId);
    if (!d.allowed) return d;
    if (templateForSignal(signal) === req.templateId) templateApproved = true;
    expiresAtMs = Math.min(expiresAtMs, signal.expiresAtMs);
  }
  if (!templateApproved) return deny('blocked_category');
  const delivery = nudgeDelivery(gate.pref ?? DEFAULT_RECIPIENT_DELIVERY,
    gate.lastNudgeAtMs === null ? null : new Date(gate.lastNudgeAtMs), new Date(gate.nowMs));
  if (!delivery.deliver) return { allowed: false, reason: delivery.reason };
  return { ...ALLOW, expiresAtMs };
}

export type PolicyErrorCode = 'invalid' | 'not_found' | 'unauthorized' | 'stale' | 'rate_limited';
/** Reducer/API error code for a denial (API.md). Messages must carry only the reason code. */
export function policyErrorCode(reason: DenyReason | DeliveryDenyReason): PolicyErrorCode {
  switch (reason) {
    case 'invalid_schema': return 'invalid';
    case 'wrong_recipient': return 'not_found'; // no existence leak to non-members
    case 'no_consent':
    case 'blocked_category':
    case 'not_opted_in': return 'unauthorized';
    case 'unlinked': return 'invalid';
    case 'expired':
    case 'revoked':
    case 'stale_policy': return 'stale';
    case 'quiet_hours':
    case 'cooldown': return 'rate_limited';
  }
}
