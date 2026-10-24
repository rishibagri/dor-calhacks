/**
 * PROPOSED C8 discovery guards (Cyber, D031/D035; CS/DS/AI review pending). Runtime-dependency-free so the
 * SpacetimeDB module enforces the same rules (re-exported from `@kinetic/contracts/policy`).
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

/** Developer allowlists (interest tags, coarse launch areas): short lowercase slugs only. */
export function validSlugAllowlist(values: readonly string[], kind: 'tag' | 'area'): boolean {
  const re = kind === 'tag' ? TAG_RE : AREA_RE;
  return values.length > 0 && values.length <= 256 && new Set(values).size === values.length &&
    values.every(v => typeof v === 'string' && re.test(v) && !looksLikeContactOrId(v));
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
