/**
 * DS-R3 local event eligibility and same-event companions. Pure and deterministic: no I/O, no clock reads, no
 * provider calls. Wraps rankNearby (event mode) without changing it.
 *
 * Eligibility uses only public catalogue facts and explicitly published intents:
 * - An event is eligible when it is in person, in the viewer's currently approved coarse area, scheduled (not
 *   cancelled or unknown), not yet started, at least MIN_LEAD_MS away, within the horizon, freshly fetched and
 *   tagged only with allowlisted topics. Duplicate rows for one canonical event ID resolve to the latest fetch;
 *   on a tie the more restrictive status wins, so a conflicting cancelled copy never surfaces as scheduled.
 * - An intent counts only while unexpired and only for an eligible event (one that has not started yet).
 *   Intent is self-declared ("interested"/"going"); nothing here is attendance.
 * - Companions come from rankNearby, which re-checks block/withdraw/expiry/already-connected/self per card.
 * Online activities for existing long-distance connections stay in rankActivities (allowInPerson false).
 *
 * `EventListing` is a DS consumer proposal: C8/D034 `CatalogueEventRef` plus the coarse `areaKey` of the
 * developer-configured regional feed it came from. It is not a wire type; replace it once CS/Cyber land the
 * reviewed C7/C8 shape. There is no title, URL, venue, attendee list, coordinate or private field in it.
 */
import type { CatalogueEventRef } from '@dor/contracts';
import { HORIZON_MS, MAX_SOURCE_AGE_MS, MIN_LEAD_MS } from './rank.ts';
import { SHORTLIST_SIZE, rankNearby } from './nearby.ts';
import type {
  DiscoveryShortlist, DiscoveryViewer, PublishedEventIntent, ShortlistEntry,
} from '../features/discovery/types.ts';

export interface EventListing extends CatalogueEventRef {
  /** Coarse area key of the regional feed (null for online rows). Never a coordinate or venue. */
  areaKey: string | null;
}

export type EventExclusionReason =
  | 'invalid_event' | 'format_out_of_scope' | 'wrong_area' | 'cancelled' | 'time_unverified' | 'expired_source'
  | 'already_started' | 'starts_too_soon' | 'beyond_horizon' | 'duplicate';

export type EventNoResultReason =
  /** Viewer has not published a discovery profile. */
  | 'not_published'
  /** Viewer has no current approved area (never set, expired or withdrawn): no in-person events at all. */
  | 'no_active_area'
  /** No catalogue event passed eligibility. */
  | 'no_eligible_event'
  /** Eligible events exist, but the viewer published no current intent for any of them. */
  | 'viewer_no_event_intent'
  /** The viewer has intents, but no eligible person published a current intent for the same event. */
  | 'no_companions';

export interface EventCompanions {
  eventId: string;
  viewerIntent: PublishedEventIntent['intent'];
  /** At most SHORTLIST_SIZE, from rankNearby event mode. */
  companions: ShortlistEntry[];
}

export interface EventEligibility {
  /** Eligible canonical event IDs, soonest first. Public catalogue facts only. */
  eligible: string[];
  excluded: { eventId: string | null; reason: EventExclusionReason }[];
}

export type EventShortlist =
  | { kind: 'events'; events: EventCompanions[]; eligibility: EventEligibility }
  | { kind: 'none'; reason: EventNoResultReason; eligibility: EventEligibility };

export interface EventInput {
  viewer: DiscoveryViewer;
  /** The viewer's own currently active coarse area, from area participation; null when none is active. */
  viewerAreaKey: string | null;
  /** Untrusted catalogue rows from CS's regional feed. */
  events: unknown[];
  /** Untrusted authorized candidate rows (same page rankNearby takes). */
  candidates: unknown[];
  /** Developer-configured discovery tag allowlist. */
  allowedTags: string[];
  now: Date;
  /** Max events returned. */
  limit?: number;
}

const EVENT_KEYS = new Set(['eventId', 'startsAt', 'endsAt', 'status', 'fetchedAt', 'topics', 'format', 'areaKey']);
const TAG_RE = /^[a-z][a-z0-9-]{1,31}$/;
const AREA_RE = /^[a-z0-9][a-z0-9:_-]{0,63}$/;
const MAX_ID = 128, MAX_TOPICS = 5;
export const MAX_EVENTS = 3;
/** Higher wins a same-fetch tie: the most restrictive reading of conflicting copies. */
const STATUS_WEIGHT: Record<CatalogueEventRef['status'], number> = { scheduled: 0, unknown: 1, cancelled: 2 };

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isTime = (v: unknown): v is string => isStr(v, 64) && Number.isFinite(Date.parse(v));
const idOf = (raw: unknown) => (typeof raw === 'object' && raw !== null && isStr((raw as { eventId?: unknown }).eventId, MAX_ID)
  ? (raw as { eventId: string }).eventId : null);

/** Strict shape check; anything unexpected rejects the row rather than being repaired. */
export function parseEventListing(raw: unknown, allowed: ReadonlySet<string>): EventListing | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !Object.keys(raw).every(k => EVENT_KEYS.has(k))) return null;
  const e = raw as Record<string, unknown>;
  const topics = e.topics;
  const ok = isStr(e.eventId, MAX_ID) && isTime(e.startsAt) && (e.endsAt === undefined || isTime(e.endsAt)) &&
    (e.status === 'scheduled' || e.status === 'cancelled' || e.status === 'unknown') && isTime(e.fetchedAt) &&
    (e.format === 'in_person' || e.format === 'online') &&
    (e.areaKey === null || (typeof e.areaKey === 'string' && AREA_RE.test(e.areaKey))) &&
    Array.isArray(topics) && topics.length <= MAX_TOPICS && new Set(topics).size === topics.length &&
    topics.every(t => typeof t === 'string' && TAG_RE.test(t) && allowed.has(t)) &&
    (e.endsAt === undefined || Date.parse(e.endsAt as string) > Date.parse(e.startsAt as string));
  return ok ? (raw as EventListing) : null;
}

/** Pure eligibility over the catalogue. Does not look at people at all. */
export function eligibleEvents(events: unknown[], viewerAreaKey: string | null, allowedTags: string[], now: Date):
  { eligible: EventListing[]; excluded: EventEligibility['excluded'] } {
  const allowed = new Set(allowedTags.filter(t => TAG_RE.test(t)));
  const excluded: EventEligibility['excluded'] = [];
  const t = now.getTime();

  // Resolve duplicates first so the same canonical event always yields the same reading, whatever the row order.
  const latest = new Map<string, EventListing>();
  for (const raw of events) {
    const e = parseEventListing(raw, allowed);
    if (!e) { excluded.push({ eventId: idOf(raw), reason: 'invalid_event' }); continue; }
    const prev = latest.get(e.eventId);
    if (!prev) { latest.set(e.eventId, e); continue; }
    const newer = Date.parse(e.fetchedAt) - Date.parse(prev.fetchedAt) ||
      STATUS_WEIGHT[e.status] - STATUS_WEIGHT[prev.status] || e.startsAt.localeCompare(prev.startsAt);
    excluded.push({ eventId: e.eventId, reason: 'duplicate' });
    if (newer > 0) latest.set(e.eventId, e);
  }

  const eligible: EventListing[] = [];
  for (const e of [...latest.values()].sort((a, b) => a.eventId.localeCompare(b.eventId))) {
    const out = (reason: EventExclusionReason) => excluded.push({ eventId: e.eventId, reason });
    const start = Date.parse(e.startsAt);
    if (e.format !== 'in_person') { out('format_out_of_scope'); continue; }
    if (viewerAreaKey === null || e.areaKey !== viewerAreaKey) { out('wrong_area'); continue; }
    if (e.status === 'cancelled') { out('cancelled'); continue; }
    if (e.status !== 'scheduled') { out('time_unverified'); continue; }
    if (t - Date.parse(e.fetchedAt) > MAX_SOURCE_AGE_MS) { out('expired_source'); continue; }
    if (start <= t) { out('already_started'); continue; }
    if (start - t < MIN_LEAD_MS) { out('starts_too_soon'); continue; }
    if (start - t > HORIZON_MS) { out('beyond_horizon'); continue; }
    eligible.push(e);
  }
  eligible.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.eventId.localeCompare(b.eventId));
  excluded.sort((a, b) => (a.eventId ?? '').localeCompare(b.eventId ?? '') || a.reason.localeCompare(b.reason));
  return { eligible, excluded };
}

/**
 * For each eligible event the viewer published a current intent for, the eligible people who published a current
 * intent for that same event. No suggestion unless both sides explicitly published; never inferred.
 */
export function rankEventCompanions(input: EventInput): EventShortlist {
  const now = input.now.getTime();
  const { eligible, excluded } = eligibleEvents(input.events, input.viewerAreaKey, input.allowedTags, input.now);
  const eligibility: EventEligibility = { eligible: eligible.map(e => e.eventId), excluded };
  const none = (reason: EventNoResultReason): EventShortlist => ({ kind: 'none', reason, eligibility });

  if (!input.viewer.published) return none('not_published');
  if (input.viewerAreaKey === null) return none('no_active_area');
  if (eligible.length === 0) return none('no_eligible_event');

  const byId = new Map(eligible.map(e => [e.eventId, e]));
  const viewerIntents = new Map(input.viewer.eventIntents
    .filter(i => byId.has(i.eventId) && Date.parse(i.expiresAt) > now).map(i => [i.eventId, i]));
  if (viewerIntents.size === 0) return none('viewer_no_event_intent');

  // Each pass ranks one eligible event, and rankNearby event mode requires both people's current intent for that
  // exact event ID, so intents for ineligible (ended, cancelled, out-of-area) events can never create a match.
  const viewer: DiscoveryViewer = { ...input.viewer, eventIntents: [...viewerIntents.values()] };

  const results: EventCompanions[] = [];
  for (const e of eligible) {
    const mine = viewerIntents.get(e.eventId);
    if (!mine) continue;
    const r: DiscoveryShortlist = rankNearby({ viewer, candidates: input.candidates, allowedTags: input.allowedTags, now: input.now,
      mode: { kind: 'event', eventId: e.eventId, eventTags: e.topics }, limit: SHORTLIST_SIZE });
    // Event mode requires a shared current intent; keep only entries that actually carry it.
    const companions = r.kind === 'shortlist' ? r.entries.filter(x => x.sharedEventId === e.eventId) : [];
    if (companions.length > 0) results.push({ eventId: e.eventId, viewerIntent: mine.intent, companions });
  }
  if (results.length === 0) return none('no_companions');
  return { kind: 'events', events: results.slice(0, input.limit ?? MAX_EVENTS), eligibility };
}
