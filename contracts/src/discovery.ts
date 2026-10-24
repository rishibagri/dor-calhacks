/**
 * PROPOSED C8 discovery guards (Cyber, D031/D035; CS/DS/AI review pending). Runtime-dependency-free so the
 * SpacetimeDB module enforces the same rules (re-exported from `@dor/contracts/policy`).
 *
 * Three separate consents (contracts/specs/DISCOVERY.md): profile publication, introduction acceptance,
 * and C2/C3 pair sharing. Nothing here reads or grants pair signals, presets, support preferences, quiz
 * answers, journals or coordinates. Publication permits only the named fields to the displayed audience.
 *
 * Callers pass the authenticated caller (ctx.sender) and authoritative rows; `nowMs` from ctx.timestamp,
 * or null in views (no clock), where the scheduled expiry sweep marks expired rows instead.
 */

/** Version of the publication notice ("who sees what, for how long"). Bump when the wording changes. */
export const DISCOVERY_NOTICE_VERSION = 1;
/** Proposed defaults (docs/features/LOCAL_CONNECTIONS.md); owner-reviewed values, not measured ones. */
export const PUBLICATION_MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const AREA_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const DISCOVERY_CARD_LIMIT = 50;
export const DISCOVERY_AUDIENCES = ['area_discoverers'] as const;
export const MAX_INTEREST_TAGS = 8;
export const MAX_PUBLIC_NAME = 40;

export type DiscoveryDenyReason =
  | 'invalid_schema' | 'disabled' | 'not_published' | 'withdrawn' | 'expired' | 'area_mismatch'
  | 'blocked' | 'self' | 'tag_not_allowlisted' | 'area_not_allowlisted' | 'looks_like_identifier' | 'stale_revision';
type Deny = { ok: false; reason: DiscoveryDenyReason };
const no = (reason: DiscoveryDenyReason): Deny => ({ ok: false, reason });

const TAG_RE = /^[a-z][a-z0-9-]{1,31}$/;
const AREA_RE = /^[a-z][a-z0-9-]{2,63}$/;
// Defence in depth: a public name must not smuggle contact details or identifiers.
const IDENTIFIER_RES = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /[0-9a-f]{24,}/i,
  /[^\s@]+@[^\s@]+\.[^\s@]+/,
  /(\d[\s().-]*){7,}/,
  /https?:\/\/|www\.|\.(com|net|org|io|me|app|dev)\b/i,
  /(^|\s)@[a-z0-9_.]{2,}/i,
];
// Control, bidi-override and zero-width characters that could spoof a displayed name.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/;
export const looksLikeContactOrId = (s: string): boolean => IDENTIFIER_RES.some(re => re.test(s));

/**
 * D046 safety net: tag segments that would publish a special-category or stigmatising fact about a person (health,
 * recovery, grief, sexuality, religion, immigration status, legal or financial trouble). D045 makes transitions
 * ("starting college", "new to the city") discovery tags; this keeps an allowlist from ever offering, say, `divorce`
 * or `rehab` as a public profile label. Matching is per hyphen segment (prefix stems; `trans` exact), so `transit`
 * and `hiking` pass. A net, not a classifier: the developer allowlist is still reviewed.
 */
const SENSITIVE_STEMS = ['health', 'medic', 'mental', 'therap', 'rehab', 'sober', 'addict', 'grief', 'griev', 'bereav', 'widow',
  'divorc', 'separat', 'pregnan', 'abortion', 'ivf', 'hiv', 'cancer', 'disab', 'diagnos', 'immigra', 'visa', 'asylum', 'refugee',
  'undocumented', 'religio', 'church', 'mosque', 'synagogue', 'temple', 'lgbt', 'gay', 'lesbian', 'queer', 'bisexual', 'sexual',
  'politic', 'prison', 'parole', 'criminal', 'debt', 'bankrupt', 'unemploy', 'homeless', 'evict', 'abuse', 'suicid'];
const SENSITIVE_EXACT = ['trans', 'nonbinary'];
export function looksSensitiveTag(tag: string): boolean {
  if (tag.includes('self-harm')) return true;
  return tag.split('-').some(s => SENSITIVE_EXACT.includes(s) || SENSITIVE_STEMS.some(stem => s.startsWith(stem)));
}

/** Developer allowlists (interest/transition tags, coarse launch areas): short lowercase slugs only. */
export function validSlugAllowlist(values: readonly string[], kind: 'tag' | 'area'): boolean {
  const re = kind === 'tag' ? TAG_RE : AREA_RE;
  return values.length > 0 && values.length <= 256 && new Set(values).size === values.length &&
    values.every(v => typeof v === 'string' && re.test(v) && !looksLikeContactOrId(v) && !(kind === 'tag' && looksSensitiveTag(v)));
}

export interface PublicationDraft {
  displayName: string;
  interestTags: string[];
  audience: (typeof DISCOVERY_AUDIENCES)[number];
  noticeVersion: number;
  expiresAtMs: number;
}
const DRAFT_KEYS = ['displayName', 'interestTags', 'audience', 'noticeVersion', 'expiresAtMs'];

/**
 * Validates the owner's exact publication preview. Default deny: unknown keys (avatar URLs, bios, location,
 * contact fields) are rejected, tags must be allowlisted, the name must not carry contact details, and the
 * notice version and duration must be the ones shown. Returns a fresh object, never the caller's.
 */
export function guardPublicationDraft(input: unknown, allowedTags: readonly string[], nowMs: number):
  { ok: true; draft: PublicationDraft } | Deny {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Number.isFinite(nowMs)) return no('invalid_schema');
  const d = input as Record<string, unknown>;
  if (Object.keys(d).some(k => !DRAFT_KEYS.includes(k))) return no('invalid_schema');
  if (!validSlugAllowlist(allowedTags, 'tag')) return no('tag_not_allowlisted');
  if (typeof d.displayName !== 'string') return no('invalid_schema');
  const name = d.displayName.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > MAX_PUBLIC_NAME || UNSAFE_CHARS.test(name)) return no('invalid_schema');
  if (looksLikeContactOrId(name)) return no('looks_like_identifier');
  const tags = d.interestTags;
  if (!Array.isArray(tags) || tags.length === 0 || tags.length > MAX_INTEREST_TAGS ||
    new Set(tags).size !== tags.length || !tags.every(t => typeof t === 'string')) return no('invalid_schema');
  if (!tags.every(t => allowedTags.includes(t as string))) return no('tag_not_allowlisted');
  if (!(DISCOVERY_AUDIENCES as readonly unknown[]).includes(d.audience)) return no('invalid_schema');
  if (d.noticeVersion !== DISCOVERY_NOTICE_VERSION) return no('stale_revision');
  if (!Number.isSafeInteger(d.expiresAtMs) || (d.expiresAtMs as number) <= nowMs ||
    (d.expiresAtMs as number) > nowMs + PUBLICATION_MAX_LIFETIME_MS) return no('invalid_schema');
  return { ok: true, draft: { displayName: name, interestTags: [...tags] as string[],
    audience: d.audience as PublicationDraft['audience'], noticeVersion: DISCOVERY_NOTICE_VERSION,
    expiresAtMs: d.expiresAtMs as number } };
}

/**
 * Area participation: the device coarsens its one-time sample to one of the developer-configured areas and
 * sends only that key. Arbitrary keys (geohashes, coordinates, cell ids) are rejected, so precision cannot
 * be widened silently by a client.
 */
export function guardAreaKey(areaKey: unknown, allowedAreas: readonly string[]): { ok: true; areaKey: string } | Deny {
  if (typeof areaKey !== 'string' || !AREA_RE.test(areaKey)) return no('invalid_schema');
  if (!validSlugAllowlist(allowedAreas, 'area') || !allowedAreas.includes(areaKey)) return no('area_not_allowlisted');
  return { ok: true, areaKey };
}

export interface PublicationState {
  publicationId: string;
  ownerId: string;
  displayName: string;
  interestTags: readonly string[];
  audience: string;
  noticeVersion: number;
  revision: number;
  expiresAtMs: number;
  withdrawnAtMs: number | null;
  /** Set by the expiry sweep; the only expiry signal views have. */
  expiredMarked: boolean;
}
export interface AreaState { ownerId: string; areaKey: string; expiresAtMs: number; active: boolean; expiredMarked: boolean }
export interface DiscoveryParty { id: string; publication: PublicationState | null; area: AreaState | null }

function active(p: DiscoveryParty, nowMs: number | null): DiscoveryDenyReason | null {
  const pub = p.publication, area = p.area;
  if (!pub || pub.ownerId !== p.id) return 'not_published';
  if (pub.withdrawnAtMs !== null) return 'withdrawn';
  if (pub.expiredMarked || (nowMs !== null && pub.expiresAtMs <= nowMs)) return 'expired';
  if (pub.noticeVersion !== DISCOVERY_NOTICE_VERSION || !(DISCOVERY_AUDIENCES as readonly string[]).includes(pub.audience)) return 'stale_revision';
  if (!area || area.ownerId !== p.id || !area.active) return 'not_published';
  if (area.expiredMarked || (nowMs !== null && area.expiresAtMs <= nowMs)) return 'expired';
  return null;
}

/**
 * Whether `viewer` may see `target`'s card. Audience = signed-in discoverers who are themselves currently
 * published in the same configured area (reciprocal), with no block in either direction. The viewer's
 * own state is checked first so a non-participant learns nothing about others.
 */
export function guardDiscoveryVisibility(viewer: DiscoveryParty, target: DiscoveryParty,
  blockedEitherWay: boolean, enabled: boolean, nowMs: number | null): { ok: true } | Deny {
  if (!enabled) return no('disabled');
  if (!viewer.id || !target.id) return no('invalid_schema');
  if (viewer.id === target.id) return no('self');
  const v = active(viewer, nowMs);
  if (v) return no(v);
  const t = active(target, nowMs);
  if (t) return no(t);
  if (viewer.area!.areaKey !== target.area!.areaKey) return no('area_mismatch');
  if (blockedEitherWay) return no('blocked');
  return { ok: true };
}

export interface DiscoveryCardProjection {
  cardRef: string;
  displayName: string;
  interestTags: string[];
  sharedTags: string[];
  revision: number;
}
/** The ONLY fields a peer receives: opaque reference, approved public fields, and overlap with the viewer. */
export function projectDiscoveryCard(target: PublicationState, viewerTags: readonly string[]): DiscoveryCardProjection {
  return {
    cardRef: target.publicationId, displayName: target.displayName, interestTags: [...target.interestTags],
    sharedTags: target.interestTags.filter(t => viewerTags.includes(t)), revision: target.revision,
  };
}

export type DiscoveryErrorCode = 'invalid' | 'not_found' | 'unauthorized' | 'stale' | 'unavailable';
/** Reducer error code. `blocked`, `self` and target-side states map to not_found: no existence or block oracle. */
export function discoveryErrorCode(reason: DiscoveryDenyReason): DiscoveryErrorCode {
  switch (reason) {
    case 'disabled': return 'unavailable';
    case 'invalid_schema':
    case 'tag_not_allowlisted':
    case 'area_not_allowlisted':
    case 'looks_like_identifier': return 'invalid';
    case 'stale_revision':
    case 'expired': return 'stale';
    case 'not_published':
    case 'withdrawn': return 'unauthorized';
    case 'blocked':
    case 'self':
    case 'area_mismatch': return 'not_found';
  }
}

// ---- CYBER-R2: introductions, report and repeat-probe limits (PROPOSED C8; D038) ----

/** A pending introduction request lapses after this; the recipient alone may accept or decline before then. */
export const INTRODUCTION_REQUEST_LIFETIME_MS = 72 * 60 * 60 * 1000;
/** AI introduction proposals are suggestions to the viewer only (D033 24 h cap). */
export const INTRODUCTION_PROPOSAL_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** After a decline or an unanswered lapse, the same sender cannot ask the same person again for this long. */
export const INTRODUCTION_DECLINE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_PENDING_OUTGOING_INTRODUCTIONS = 5;
export const MAX_CLIENT_REQUEST_ID = 64;
/** Coarse report reasons only; free text could carry personal data and would reach moderators verbatim. */
export const DISCOVERY_REPORT_REASONS = ['spam', 'harassment', 'impersonation', 'inappropriate_profile', 'other'] as const;
export type DiscoveryReportReason = (typeof DISCOVERY_REPORT_REASONS)[number];

/**
 * Per-caller fixed-window limits on actions that take a card reference or move the caller between areas.
 * They bound enumeration (probing which refs exist / who is where by hopping areas) and invitation spam.
 * Proposed defaults, owner-reviewed, not measured. Scope is one database: one SpacetimeDB module instance.
 */
export const DISCOVERY_RATE_LIMITS = {
  introduction_request: { windowMs: 24 * 60 * 60 * 1000, max: 10 },
  block: { windowMs: 24 * 60 * 60 * 1000, max: 20 },
  report: { windowMs: 24 * 60 * 60 * 1000, max: 10 },
  area_change: { windowMs: 24 * 60 * 60 * 1000, max: 4 },
  publish: { windowMs: 24 * 60 * 60 * 1000, max: 20 },
  event_intent: { windowMs: 24 * 60 * 60 * 1000, max: 30 },
  activity_approval: { windowMs: 24 * 60 * 60 * 1000, max: 20 },
} as const;
export type DiscoveryRateAction = keyof typeof DISCOVERY_RATE_LIMITS;
export interface RateWindow { windowStartMs: number; count: number }

/**
 * Fixed-window counter. Returns the window to store when allowed. A clock that runs backwards keeps the
 * current window (never resets the count early).
 */
export function guardRateLimit(action: DiscoveryRateAction, current: RateWindow | null, nowMs: number):
  { ok: true; next: RateWindow } | { ok: false; reason: 'rate_limited' | 'invalid_schema' } {
  const limit = DISCOVERY_RATE_LIMITS[action];
  if (!limit || !Number.isFinite(nowMs)) return { ok: false, reason: 'invalid_schema' };
  if (!current || nowMs >= current.windowStartMs + limit.windowMs) return { ok: true, next: { windowStartMs: nowMs, count: 1 } };
  if (current.count >= limit.max) return { ok: false, reason: 'rate_limited' };
  return { ok: true, next: { windowStartMs: current.windowStartMs, count: current.count + 1 } };
}

export const INTRODUCTION_STATUSES = ['pending', 'accepted', 'declined', 'cancelled', 'expired', 'ended'] as const;
export type IntroductionStatus = (typeof INTRODUCTION_STATUSES)[number];
export interface IntroductionState {
  introId: string;
  senderId: string;
  recipientId: string;
  status: IntroductionStatus;
  /** Sender publication revision the request was made from; an edited profile stales the pending request. */
  senderRevision: number;
  createdAtMs: number;
  expiresAtMs: number;
  respondedAtMs: number | null;
}

export type IntroductionDenyReason = DiscoveryDenyReason | 'rate_limited' | 'already_pending' | 'already_connected'
  | 'declined_cooldown' | 'pending_limit' | 'not_pending' | 'not_participant' | 'request_id_reused';
type IntroDeny = { ok: false; reason: IntroductionDenyReason };
const deny = (reason: IntroductionDenyReason): IntroDeny => ({ ok: false, reason });
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const validClientRequestId = (s: unknown): s is string => typeof s === 'string' && REQUEST_ID_RE.test(s);

/**
 * A human-triggered introduction request to a card the sender can see right now. `between` is every
 * introduction between the two people in either direction. Order: visibility first (no oracle about people
 * the sender cannot see), then relationship state, then the sender's own limits.
 */
export function guardIntroductionRequest(input: {
  sender: DiscoveryParty; recipient: DiscoveryParty; blockedEitherWay: boolean; enabled: boolean; nowMs: number;
  between: readonly IntroductionState[]; senderPendingOutgoing: number;
}): { ok: true; expiresAtMs: number } | IntroDeny {
  const { sender, recipient, nowMs } = input;
  const seen = guardDiscoveryVisibility(sender, recipient, input.blockedEitherWay, input.enabled, nowMs);
  if (!seen.ok) return seen;
  for (const i of input.between) {
    if (i.status === 'accepted') return deny('already_connected');
    if (i.status === 'pending' && i.expiresAtMs > nowMs) return deny('already_pending');
    // The sender's own earlier request: a decline looks exactly like no answer. It stays "pending" to them until
    // it lapses, then the same cooldown follows either way, anchored on the original expiry, never on the decline.
    if (i.senderId === sender.id && (i.status === 'pending' || i.status === 'declined' || i.status === 'expired')) {
      if (nowMs < i.expiresAtMs) return deny('already_pending');
      if (nowMs < i.expiresAtMs + INTRODUCTION_DECLINE_COOLDOWN_MS) return deny('declined_cooldown');
    }
  }
  if (input.senderPendingOutgoing >= MAX_PENDING_OUTGOING_INTRODUCTIONS) return deny('pending_limit');
  const expiresAtMs = Math.min(nowMs + INTRODUCTION_REQUEST_LIFETIME_MS,
    sender.publication!.expiresAtMs, recipient.publication!.expiresAtMs);
  return { ok: true, expiresAtMs };
}

function publicationStands(p: DiscoveryParty, nowMs: number): DiscoveryDenyReason | null {
  const pub = p.publication;
  if (!pub || pub.ownerId !== p.id) return 'not_published';
  if (pub.withdrawnAtMs !== null) return 'withdrawn';
  if (pub.expiredMarked || pub.expiresAtMs <= nowMs) return 'expired';
  return null;
}

/**
 * Own-action authority over a request: only the recipient accepts or declines, only the sender cancels, and
 * only while pending and unexpired. Accepting also needs both publications still standing, no block either
 * way and the sender's profile unchanged since the request (the recipient accepts what they were shown).
 * Area is not rechecked at acceptance: the request was made while both were in the same area.
 */
export function guardIntroductionResponse(input: {
  intro: IntroductionState; callerId: string; action: 'accept' | 'decline' | 'cancel';
  sender: DiscoveryParty; recipient: DiscoveryParty; blockedEitherWay: boolean; enabled: boolean; nowMs: number;
}): { ok: true; status: IntroductionStatus } | IntroDeny {
  const { intro, callerId, action, nowMs } = input;
  const isSender = callerId === intro.senderId, isRecipient = callerId === intro.recipientId;
  if (!isSender && !isRecipient) return deny('not_participant');
  if (action === 'cancel' ? !isSender : !isRecipient) return deny('not_participant');
  if (intro.status !== 'pending') return deny('not_pending');
  if (intro.expiresAtMs <= nowMs) return deny('expired');
  if (action === 'decline') return { ok: true, status: 'declined' };
  if (action === 'cancel') return { ok: true, status: 'cancelled' };
  if (!input.enabled) return deny('disabled');
  if (input.sender.id !== intro.senderId || input.recipient.id !== intro.recipientId) return deny('invalid_schema');
  if (input.blockedEitherWay) return deny('blocked');
  const s = publicationStands(input.sender, nowMs) ?? publicationStands(input.recipient, nowMs);
  if (s) return deny(s);
  if (input.sender.publication!.revision !== intro.senderRevision) return deny('stale_revision');
  return { ok: true, status: 'accepted' };
}

export interface IntroductionProposalCommit {
  viewerRef: string;
  candidateRef: string;
  viewerPublicationVersion: number;
  candidatePublicationVersion: number;
  reasonCode: string;
  sharedTags: readonly string[];
  eventId?: string | null;
  openerId: string;
  expiresAtMs: number;
}

/**
 * Worker commit of an AI introduction proposal (D033) to the viewer's private proposal list. Re-runs current
 * visibility between viewer and candidate (withdrawal, block, area or expiry during generation all deny),
 * binds both publication versions, and allows only tags both people currently publish. same_event needs C8
 * event intents (CYBER-R3), so it is refused until those records exist. Model output is never authority.
 */
export function guardIntroductionProposalCommit(p: IntroductionProposalCommit, viewer: DiscoveryParty,
  candidate: DiscoveryParty, blockedEitherWay: boolean, enabled: boolean, nowMs: number):
  { ok: true; expiresAtMs: number } | IntroDeny {
  const seen = guardDiscoveryVisibility(viewer, candidate, blockedEitherWay, enabled, nowMs);
  if (!seen.ok) return seen;
  const v = viewer.publication!, c = candidate.publication!;
  if (p.viewerRef !== v.publicationId || p.candidateRef !== c.publicationId) return deny('invalid_schema');
  if (p.viewerPublicationVersion !== v.revision || p.candidatePublicationVersion !== c.revision) return deny('stale_revision');
  if (p.reasonCode !== 'shared_interest' || p.openerId !== 'suggest_shared_interest' || p.eventId) return deny('invalid_schema');
  const tags = p.sharedTags;
  if (!Array.isArray(tags) || tags.length === 0 || tags.length > 3 || new Set(tags).size !== tags.length) return deny('invalid_schema');
  if (!tags.every(t => v.interestTags.includes(t) && c.interestTags.includes(t))) return deny('invalid_schema');
  if (!Number.isSafeInteger(p.expiresAtMs) || p.expiresAtMs <= nowMs) return deny('invalid_schema');
  return { ok: true, expiresAtMs: Math.min(p.expiresAtMs, nowMs + INTRODUCTION_PROPOSAL_LIFETIME_MS, v.expiresAtMs, c.expiresAtMs) };
}

/** Reducer message: a pending request and a post-decline/lapse cooldown read the same to the sender. */
export const introductionErrorMessage = (reason: IntroductionDenyReason): string =>
  reason === 'already_pending' || reason === 'declined_cooldown' ? 'already_requested' : reason;

/** Reducer error codes for introduction denials. Target-side states stay not_found (no existence oracle). */
export function introductionErrorCode(reason: IntroductionDenyReason): DiscoveryErrorCode | 'rate_limited' {
  switch (reason) {
    case 'rate_limited':
    case 'pending_limit': return 'rate_limited';
    case 'already_connected':
    case 'not_pending': return 'stale';
    // Same code AND message in the reducer for both (see introductionErrorMessage): no decline oracle.
    case 'already_pending':
    case 'declined_cooldown': return 'stale';
    case 'not_participant': return 'not_found';
    case 'request_id_reused': return 'invalid';
    default: return discoveryErrorCode(reason);
  }
}
