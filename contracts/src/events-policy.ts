/**
 * PROPOSED C7/C8 event guards (Cyber, CYBER-R3, D039; CS/AI/DS review pending). Runtime-dependency-free so the
 * SpacetimeDB module enforces the same rules (re-exported from `@dor/contracts/policy`).
 *
 * Three things, kept separate:
 *  1. Catalogue records: public, untrusted source data written only by the server ingester. A record is
 *     never permission; it only says what exists, when, and how fresh our copy is.
 *  2. Event intents (C8): one person's explicit "interested/going" for one event, ending with the event.
 *     Visible to others only where both people published intent for the same event.
 *  3. Shared plans: finalized by the D034 lifecycle (`plan-lifecycle.ts`) only when both people accepted the
 *     same revision while the basis (accepted introduction, or pair with current C7 activity approvals), both
 *     intents and a fresh, still-scheduled catalogue record all hold. Nothing books, RSVPs, messages or buys.
 *
 * Callers pass authoritative rows and `nowMs` from ctx.timestamp (or null in clockless views).
 */
import { safeCatalogueUrl } from './catalogue.js';
import type { PlanSourceCheck } from './plan-lifecycle.js';

/** D034: catalogue records older than this are not used for plans or new intents. */
export const CATALOGUE_MAX_SOURCE_AGE_MS = 48 * 60 * 60 * 1000;
/** Plans close at least this long before the event starts (D034). */
export const PLAN_MIN_LEAD_MS = 60 * 60 * 1000;
export const PLAN_MAX_LIFETIME_MS = 48 * 60 * 60 * 1000;
/** Intent lifetime when the source gives no end time: start + this. */
export const EVENT_DEFAULT_DURATION_MS = 4 * 60 * 60 * 1000;
/** Events further out than this are not accepted from the ingester (bounds the table and stale planning). */
export const CATALOGUE_MAX_HORIZON_MS = 60 * 24 * 60 * 60 * 1000;
export const MAX_EVENT_TITLE = 120;
export const MAX_EVENT_TOPICS = 5;
export const EVENT_INTENT_KINDS = ['interested', 'going'] as const;
export const CATALOGUE_STATUSES = ['scheduled', 'cancelled', 'unknown'] as const;
export const EVENT_FORMATS = ['in_person', 'online'] as const;
/**
 * C7 preset-only category (ACTIVITY_CONSENT.md §2). Never a C3 signal category (ApprovedSignal v2 cannot carry
 * it), never nominated by the quiz, and off in every preset until the owner adds it explicitly.
 */
export const ACTIVITY_CATEGORY = 'activity_interest' as const;
export const ACTIVITY_APPROVAL_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const ACTIVITY_CONSENT_VERSION = 1;

export type EventDenyReason =
  | 'invalid_schema' | 'topic_not_allowlisted' | 'area_not_allowlisted' | 'unsafe_source_url' | 'event_not_found'
  | 'event_cancelled' | 'event_status_unknown' | 'event_started' | 'source_stale' | 'too_far_ahead' | 'stale_revision'
  | 'not_participant' | 'basis_not_current' | 'intent_not_current' | 'approval_not_current' | 'blocked'
  | 'event_moved' | 'lead_time' | 'no_preset_category' | 'revoked' | 'expired' | 'wrong_recipient';
type Deny = { ok: false; reason: EventDenyReason };
const no = (reason: EventDenyReason): Deny => ({ ok: false, reason });

const EVENT_ID_RE = /^[a-z0-9][a-z0-9:_-]{2,127}$/;
/** Catalogue event id shape the ingester and module accept (DS ask, D047): lowercase, 3–128 chars, `a-z0-9:_-`. */
export const validEventId = (id: unknown): id is string => typeof id === 'string' && EVENT_ID_RE.test(id);
const TOPIC_RE = /^[a-z][a-z0-9-]{1,31}$/;
// Control, bidi-override and zero-width characters; markup brackets. Scraped text is display-only data.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿<>]/g;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface CatalogueEventInput {
  eventId: string;
  title: string;
  startsAtMs: number;
  endsAtMs: number | null;
  status: (typeof CATALOGUE_STATUSES)[number];
  fetchedAtMs: number;
  topics: string[];
  format: (typeof EVENT_FORMATS)[number];
  /** Configured coarse area for in-person events; null for online. Never a venue, address or coordinate. */
  areaKey: string | null;
  sourceUrl: string | null;
}
const EVENT_KEYS = ['eventId', 'title', 'startsAtMs', 'endsAtMs', 'status', 'fetchedAtMs', 'topics', 'format', 'areaKey', 'sourceUrl'];

/**
 * Normalizes one ingested record. Default deny: unknown keys (venue, organizer, attendee lists, descriptions)
 * are rejected; topics and area come from the developer allowlists; the title is display text with markup and
 * spoofing characters removed; source links pass `safeCatalogueUrl`. Returns a fresh object.
 */
export function guardCatalogueEvent(input: unknown, allow: { tags: readonly string[]; areas: readonly string[]; hosts: readonly string[] },
  nowMs: number): { ok: true; event: CatalogueEventInput } | Deny {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Number.isFinite(nowMs)) return no('invalid_schema');
  const e = input as Record<string, unknown>;
  if (Object.keys(e).some(k => !EVENT_KEYS.includes(k))) return no('invalid_schema');
  if (typeof e.eventId !== 'string' || !EVENT_ID_RE.test(e.eventId)) return no('invalid_schema');
  if (typeof e.title !== 'string') return no('invalid_schema');
  const title = e.title.normalize('NFKC').replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_EVENT_TITLE);
  if (title.length === 0) return no('invalid_schema');
  if (!(CATALOGUE_STATUSES as readonly unknown[]).includes(e.status)) return no('invalid_schema');
  if (!(EVENT_FORMATS as readonly unknown[]).includes(e.format)) return no('invalid_schema');
  if (!Number.isSafeInteger(e.startsAtMs) || !Number.isSafeInteger(e.fetchedAtMs)) return no('invalid_schema');
  const startsAtMs = e.startsAtMs as number, fetchedAtMs = e.fetchedAtMs as number;
  if (fetchedAtMs > nowMs + MAX_CLOCK_SKEW_MS) return no('invalid_schema');
  if (startsAtMs > nowMs + CATALOGUE_MAX_HORIZON_MS) return no('too_far_ahead');
  if (e.endsAtMs !== null && (!Number.isSafeInteger(e.endsAtMs) || (e.endsAtMs as number) <= startsAtMs)) return no('invalid_schema');
  const topics = e.topics;
  if (!Array.isArray(topics) || topics.length === 0 || topics.length > MAX_EVENT_TOPICS || new Set(topics).size !== topics.length ||
    !topics.every(t => typeof t === 'string' && TOPIC_RE.test(t))) return no('invalid_schema');
  if (!topics.every(t => allow.tags.includes(t as string))) return no('topic_not_allowlisted');
  let areaKey: string | null = null;
  if (e.format === 'in_person') {
    if (typeof e.areaKey !== 'string' || !allow.areas.includes(e.areaKey)) return no('area_not_allowlisted');
    areaKey = e.areaKey;
  } else if (e.areaKey !== null) return no('invalid_schema');
  let sourceUrl: string | null = null;
  if (e.sourceUrl !== null) {
    sourceUrl = safeCatalogueUrl(e.sourceUrl, allow.hosts);
    if (!sourceUrl) return no('unsafe_source_url');
  }
  return { ok: true, event: { eventId: e.eventId, title, startsAtMs, endsAtMs: e.endsAtMs as number | null,
    status: e.status as CatalogueEventInput['status'], fetchedAtMs, topics: [...topics] as string[],
    format: e.format as CatalogueEventInput['format'], areaKey, sourceUrl } };
}

export interface CatalogueEventState {
  eventId: string;
  startsAtMs: number;
  endsAtMs: number | null;
  status: string;
  fetchedAtMs: number;
  topics: readonly string[];
  /** Set by the expiry sweep when the event started or our copy went stale (clockless views). */
  staleMarked: boolean;
}

/** Whether a catalogue record may back a new intent or a plan right now. */
export function catalogueEventUsable(e: CatalogueEventState | null, nowMs: number | null): EventDenyReason | null {
  if (!e) return 'event_not_found';
  if (e.status === 'cancelled') return 'event_cancelled';
  if (e.status !== 'scheduled') return 'event_status_unknown';
  if (e.staleMarked) return 'source_stale';
  if (nowMs !== null) {
    if (nowMs >= e.startsAtMs) return 'event_started';
    if (nowMs - e.fetchedAtMs > CATALOGUE_MAX_SOURCE_AGE_MS) return 'source_stale';
  }
  return null;
}

/** Intent ends when the event ends (or start + default duration); never outlives the event. */
export const eventEndMs = (e: { startsAtMs: number; endsAtMs: number | null }): number =>
  e.endsAtMs ?? e.startsAtMs + EVENT_DEFAULT_DURATION_MS;

export function guardEventIntent(e: CatalogueEventState | null, kind: unknown, nowMs: number):
  { ok: true; expiresAtMs: number } | Deny {
  if (!(EVENT_INTENT_KINDS as readonly unknown[]).includes(kind)) return no('invalid_schema');
  const u = catalogueEventUsable(e, nowMs);
  if (u) return no(u);
  return { ok: true, expiresAtMs: eventEndMs(e!) };
}

export interface EventIntentState {
  intentId: string;
  ownerId: string;
  eventId: string;
  version: number;
  expiresAtMs: number;
  revokedAtMs: number | null;
  expiredMarked: boolean;
}
export function intentStands(i: EventIntentState | null, ownerId: string, eventId: string, version: number | null, nowMs: number | null): boolean {
  return Boolean(i && i.ownerId === ownerId && i.eventId === eventId && i.revokedAtMs === null && !i.expiredMarked &&
    (version === null || i.version === version) && (nowMs === null || i.expiresAtMs > nowMs));
}

/** One owner's C7 item approval: named pair recipient, exact topics, bound preset versions, ≤ 24 h. */
export interface ActivityApprovalState {
  approvalId: string;
  ownerId: string;
  recipientId: string;
  pairId: string;
  topics: readonly string[];
  recipientPolicyVersion: number;
  presetAssignmentVersion: number;
  consentVersion: number;
  expiresAtMs: number;
  revokedAtMs: number | null;
  expiredMarked: boolean;
}
export interface ActivityPresetState {
  /** The owner's preset currently assigned to the recipient in this pair, or null. */
  allowedCategories: readonly string[];
  version: number;
  assignmentVersion: number;
  expiresAtMs: number;
  revoked: boolean;
}

/**
 * New C7 approval. Requires the owner's current preset for this pair to include ACTIVITY_CATEGORY (default
 * off everywhere), the versions the owner previewed, allowlisted topics and the current notice version.
 */
export function guardActivityApproval(input: {
  ownerId: string; recipientId: string | null; pairAccepted: boolean; preset: ActivityPresetState | null;
  topics: unknown; allowedTopics: readonly string[]; expectedPolicyVersion: unknown; expectedAssignmentVersion: unknown;
  consentVersion: unknown; nowMs: number;
}): { ok: true; topics: string[]; expiresAtMs: number } | Deny {
  const { preset, nowMs } = input;
  if (!input.pairAccepted || !input.recipientId || input.recipientId === input.ownerId) return no('not_participant');
  const t = input.topics;
  if (!Array.isArray(t) || t.length === 0 || t.length > MAX_EVENT_TOPICS || new Set(t).size !== t.length ||
    !t.every(x => typeof x === 'string' && TOPIC_RE.test(x))) return no('invalid_schema');
  if (!t.every(x => input.allowedTopics.includes(x as string))) return no('topic_not_allowlisted');
  if (input.consentVersion !== ACTIVITY_CONSENT_VERSION) return no('stale_revision');
  if (!preset || preset.revoked || preset.expiresAtMs <= nowMs || !preset.allowedCategories.includes(ACTIVITY_CATEGORY)) {
    return no('no_preset_category');
  }
  if (input.expectedPolicyVersion !== preset.version || input.expectedAssignmentVersion !== preset.assignmentVersion) return no('stale_revision');
  return { ok: true, topics: [...t] as string[], expiresAtMs: Math.min(nowMs + ACTIVITY_APPROVAL_MAX_LIFETIME_MS, preset.expiresAtMs) };
}

/** Use-time recheck of a C7 approval (every plan commit and every acceptance). */
export function activityApprovalStands(a: ActivityApprovalState | null, preset: ActivityPresetState | null, expect: {
  ownerId: string; recipientId: string; pairId: string; eventTopics: readonly string[];
}, nowMs: number | null): EventDenyReason | null {
  if (!a) return 'approval_not_current';
  if (a.ownerId !== expect.ownerId || a.pairId !== expect.pairId) return 'approval_not_current';
  if (a.recipientId !== expect.recipientId) return 'wrong_recipient';
  if (a.revokedAtMs !== null) return 'revoked';
  if (a.expiredMarked || (nowMs !== null && a.expiresAtMs <= nowMs)) return 'expired';
  if (a.consentVersion !== ACTIVITY_CONSENT_VERSION) return 'stale_revision';
  if (!preset || preset.revoked || !preset.allowedCategories.includes(ACTIVITY_CATEGORY) ||
    preset.version !== a.recipientPolicyVersion || preset.assignmentVersion !== a.presetAssignmentVersion) return 'stale_revision';
  if (!a.topics.some(t => expect.eventTopics.includes(t))) return 'approval_not_current';
  return null;
}

/**
 * The PlanSourceCheck the D034 lifecycle consumes, computed from authoritative rows. `eventScheduled` folds in
 * source freshness and an unmoved start time; `intentsCurrent` folds in both bound intent versions AND the
 * current basis (accepted introduction or pair with standing C7 approvals), so a basis that lapses after the
 * first acceptance refuses the second.
 */
export function planSourceCheck(input: {
  nowMs: number; event: CatalogueEventState | null; planEventStartsAtMs: number;
  intentsCurrent: boolean; basisCurrent: boolean; blocked: boolean;
}): PlanSourceCheck {
  const usable = catalogueEventUsable(input.event, input.nowMs) === null && input.event!.startsAtMs === input.planEventStartsAtMs;
  return { nowMs: input.nowMs, eventScheduled: usable, intentsCurrent: input.intentsCurrent && input.basisCurrent, blocked: input.blocked };
}

/** Worker commit/revision of a plan proposal: times only from the authoritative catalogue record. */
export function guardPlanTiming(event: CatalogueEventState | null, requestedExpiresAtMs: unknown, nowMs: number):
  { ok: true; expiresAtMs: number; eventStartsAtMs: number } | Deny {
  const u = catalogueEventUsable(event, nowMs);
  if (u) return no(u);
  const latest = event!.startsAtMs - PLAN_MIN_LEAD_MS;
  if (latest <= nowMs) return no('lead_time');
  if (!Number.isSafeInteger(requestedExpiresAtMs) || (requestedExpiresAtMs as number) <= nowMs) return no('invalid_schema');
  return { ok: true, eventStartsAtMs: event!.startsAtMs,
    expiresAtMs: Math.min(requestedExpiresAtMs as number, latest, nowMs + PLAN_MAX_LIFETIME_MS) };
}

export type EventErrorCode = 'invalid' | 'not_found' | 'stale' | 'unauthorized';
/** Reducer error code. Other people's state stays not_found or stale; no existence oracle. */
export function eventErrorCode(reason: EventDenyReason): EventErrorCode {
  switch (reason) {
    case 'invalid_schema':
    case 'topic_not_allowlisted':
    case 'area_not_allowlisted':
    case 'unsafe_source_url':
    case 'too_far_ahead': return 'invalid';
    case 'event_not_found':
    case 'not_participant':
    case 'blocked': return 'not_found';
    case 'no_preset_category':
    case 'wrong_recipient': return 'unauthorized';
    default: return 'stale';
  }
}

const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** Developer allowlist of catalogue source hosts (exact host or parent domain), lowercase DNS names only. */
export function validHostAllowlist(values: readonly string[]): boolean {
  return values.length > 0 && values.length <= 64 && new Set(values).size === values.length && values.every(v => typeof v === 'string' && HOST_RE.test(v));
}
