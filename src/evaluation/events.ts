/**
 * DS-R3 local events and same-event companions over the server's authorized D039 projections. Pure and
 * deterministic: no I/O, no clock reads, no provider calls. Wraps rankNearby (event mode) without changing it.
 *
 * Permission comes only from the server. `event_companions` rows `{cardRef, eventId}` exist only where the caller can
 * see the card now AND both people currently intend the same usable event; DS never decides who intends what and never
 * receives another person's kind (interested/going) or intent expiry. Everything here only narrows:
 * - Events (`catalogue_events`, public data, not joined to users): kept when in person, in the viewer's own active
 *   coarse area (the view is not area-filtered; the client must do it), fetched ≤ CATALOGUE_MAX_SOURCE_AGE_MS ago
 *   (the same 48 h the server requires to publish an intent), not started, ≥ MIN_LEAD_MS away and ≤ HORIZON_MS out.
 *   A duplicate event ID is a projection bug: every copy is withheld.
 * - Viewer intents (`my_event_intents`, the viewer's own): active, unexpired, for an eligible event.
 * - Companions: a row counts only if its event is one the viewer currently intends AND its card is present in
 *   `discovery_cards` (strict adapter). Anything else is withheld and reported, never repaired or filled in.
 * Blocked/withdrawn/expired people are already absent from both server views; rankNearby re-checks what it can see.
 *
 * Row interfaces mirror the module's view rows in camelCase with ISO timestamps (CS's mappers convert SDK values).
 * Title and source URL are accepted but never read here. Catalogue rows may also arrive in CS's listing shape
 * (`src/components/feature/events-model.ts` `toListing`): `status: 'scheduled'`, `endsAt` omitted when empty, no title
 * or source URL. That is accepted because it carries the same facts; any other status, or any unknown key, rejects.
 */
import { CATALOGUE_MAX_SOURCE_AGE_MS, EVENT_FORMATS, EVENT_INTENT_KINDS, MAX_EVENT_TITLE, MAX_EVENT_TOPICS, validSlugAllowlist }
  from '@dor/contracts/policy';
import { fromDiscoveryCards } from '../features/discovery/adapters.ts';
import type { DiscoveryCandidate, DiscoveryShortlist, DiscoveryViewer, PublishedEventIntent, ShortlistEntry }
  from '../features/discovery/types.ts';
import { SHORTLIST_SIZE, rankNearby } from './nearby.ts';
import { HORIZON_MS, MIN_LEAD_MS } from './rank.ts';

/** `catalogue_events` row (module `CatalogueEventRow`). Public catalogue data; never permission. */
export interface CatalogueEventRow {
  eventId: string; title: string; startsAt: string; endsAt: string | null; topics: string[];
  format: (typeof EVENT_FORMATS)[number]; areaKey: string | null; sourceUrl: string | null; fetchedAt: string;
}
/** `my_event_intents` row: the viewer's own intents only. */
export interface MyEventIntentRow {
  eventId: string; kind: (typeof EVENT_INTENT_KINDS)[number]; version: number; active: boolean; expiresAt: string;
}
/** `event_companions` row: mutual-only (card, event) pair, no kind. */
export interface EventCompanionRow { cardRef: string; eventId: string }

export type EventExclusionReason =
  | 'invalid_event' | 'duplicate' | 'format_out_of_scope' | 'wrong_area' | 'expired_source' | 'already_started'
  | 'starts_too_soon' | 'beyond_horizon';

export type CompanionWithheldReason =
  /** Malformed or extra-field companion row (e.g. a leaked kind). */
  | 'invalid_companion'
  /** The viewer has no current intent for that event, or the event is not eligible here. */
  | 'not_mutual_here'
  /** No matching `discovery_cards` row: the person is not visible now (blocked, withdrawn, expired, out of area). */
  | 'card_not_visible';

export type EventNoResultReason =
  | 'not_published' | 'no_active_area' | 'no_eligible_event' | 'viewer_no_event_intent' | 'no_companions';

export interface EventCompanions {
  eventId: string;
  /** The viewer's own kind (shown only to the viewer). */
  viewerIntent: PublishedEventIntent['intent'];
  /** At most SHORTLIST_SIZE, from rankNearby event mode. No entry carries the other person's kind. */
  companions: ShortlistEntry[];
}

export interface EventEligibility {
  /** Eligible event IDs, soonest first. */
  eligible: string[];
  excluded: { eventId: string | null; reason: EventExclusionReason }[];
}

interface Diagnostics {
  eligibility: EventEligibility;
  withheld: { cardRef: string | null; eventId: string | null; reason: CompanionWithheldReason }[];
  /** Strictly adapted cards for joining shortlist entries to display fields (DiscoveryResults). */
  candidates: DiscoveryCandidate[];
}
export type EventShortlist =
  | ({ kind: 'events'; events: EventCompanions[] } & Diagnostics)
  | ({ kind: 'none'; reason: EventNoResultReason } & Diagnostics);

export interface EventCompanionInput {
  /** From `my_discovery_profile`: `{ref: publicationId, published, tags: interestTags}`. */
  viewer: Omit<DiscoveryViewer, 'eventIntents'>;
  /** `my_discovery_profile.areaKey` only while `areaActive`; otherwise null. */
  viewerAreaKey: string | null;
  catalogue: readonly unknown[];
  myIntents: readonly unknown[];
  cards: readonly unknown[];
  companions: readonly unknown[];
  /** Developer-configured discovery tag allowlist. */
  allowedTags: string[];
  now: Date;
  /** Max events returned. */
  limit?: number;
}

const CATALOGUE_KEYS = new Set(['eventId', 'title', 'startsAt', 'endsAt', 'topics', 'format', 'areaKey', 'sourceUrl', 'fetchedAt',
  'status']);
const INTENT_KEYS = new Set(['eventId', 'kind', 'version', 'active', 'expiresAt']);
const COMPANION_KEYS = new Set(['cardRef', 'eventId']);
/** Same shape as the server's catalogue event IDs (contracts/src/events-policy.ts). */
const EVENT_ID_RE = /^[a-z0-9][a-z0-9:_-]{2,127}$/;
const TAG_RE = /^[a-z][a-z0-9-]{1,31}$/;
const MAX_REF = 128;
export const MAX_EVENTS = 3;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const onlyKeys = (o: object, keys: Set<string>) => Object.keys(o).every(k => keys.has(k));
const isTime = (v: unknown): v is string => typeof v === 'string' && v.length <= 64 && Number.isFinite(Date.parse(v));
const isEventId = (v: unknown): v is string => typeof v === 'string' && EVENT_ID_RE.test(v);
/** Cyber's coarse-area slug rule (AREA_RE via validSlugAllowlist), incl. its contact/identifier screen. */
export const validAreaKey = (v: unknown): v is string => typeof v === 'string' && validSlugAllowlist([v], 'area');
const idOf = (raw: unknown) => (isObj(raw) && isEventId(raw.eventId) ? raw.eventId : null);

/**
 * Strict shape check for one catalogue row (view shape or CS's listing shape); anything unexpected rejects it.
 * Returns a normalized copy in the view shape (absent `endsAt`/`title`/`sourceUrl` → null / '' / null).
 */
export function parseCatalogueEvent(raw: unknown, allowed: ReadonlySet<string>): CatalogueEventRow | null {
  if (!isObj(raw) || !onlyKeys(raw, CATALOGUE_KEYS)) return null;
  const e = raw, topics = e.topics;
  const endsAt = e.endsAt === undefined ? null : e.endsAt;
  const ok = isEventId(e.eventId) && (e.status === undefined || e.status === 'scheduled') &&
    (e.title === undefined || (typeof e.title === 'string' && e.title.length <= MAX_EVENT_TITLE)) &&
    isTime(e.startsAt) && (endsAt === null || (isTime(endsAt) && Date.parse(endsAt) > Date.parse(e.startsAt))) &&
    Array.isArray(topics) && topics.length <= MAX_EVENT_TOPICS && new Set(topics).size === topics.length &&
    topics.every(t => typeof t === 'string' && TAG_RE.test(t) && allowed.has(t)) &&
    (EVENT_FORMATS as readonly unknown[]).includes(e.format) && (e.areaKey === null || validAreaKey(e.areaKey)) &&
    (e.sourceUrl === undefined || e.sourceUrl === null || typeof e.sourceUrl === 'string') && isTime(e.fetchedAt);
  if (!ok) return null;
  return { eventId: e.eventId as string, title: (e.title as string | undefined) ?? '', startsAt: e.startsAt as string,
    endsAt: endsAt as string | null, topics: [...(topics as string[])], format: e.format as CatalogueEventRow['format'],
    areaKey: e.areaKey as string | null, sourceUrl: (e.sourceUrl as string | null | undefined) ?? null, fetchedAt: e.fetchedAt as string };
}

/** Narrows the public catalogue to events this viewer may be shown companions for. Never looks at people. */
export function eligibleEvents(catalogue: readonly unknown[], viewerAreaKey: string | null, allowedTags: string[], now: Date):
  { eligible: CatalogueEventRow[]; excluded: EventEligibility['excluded'] } {
  const allowed = new Set(allowedTags.filter(t => TAG_RE.test(t)));
  const excluded: EventEligibility['excluded'] = [];
  const t = now.getTime();

  const byId = new Map<string, CatalogueEventRow[]>();
  for (const raw of catalogue) {
    const e = parseCatalogueEvent(raw, allowed);
    if (!e) { excluded.push({ eventId: idOf(raw), reason: 'invalid_event' }); continue; }
    byId.set(e.eventId, [...(byId.get(e.eventId) ?? []), e]);
  }
  const eligible: CatalogueEventRow[] = [];
  for (const [eventId, copies] of byId) {
    const out = (reason: EventExclusionReason) => excluded.push({ eventId, reason });
    // The view is keyed by event ID, so two copies mean the projection is wrong: withhold rather than pick one.
    if (copies.length > 1) { copies.forEach(() => out('duplicate')); continue; }
    const e = copies[0]!, start = Date.parse(e.startsAt);
    if (e.format !== 'in_person') { out('format_out_of_scope'); continue; }
    // Row areaKeys already passed validAreaKey, so a null, precise or malformed viewer key can never match.
    if (viewerAreaKey === null || e.areaKey !== viewerAreaKey) { out('wrong_area'); continue; }
    if (t - Date.parse(e.fetchedAt) > CATALOGUE_MAX_SOURCE_AGE_MS) { out('expired_source'); continue; }
    if (start <= t) { out('already_started'); continue; }
    if (start - t < MIN_LEAD_MS) { out('starts_too_soon'); continue; }
    if (start - t > HORIZON_MS) { out('beyond_horizon'); continue; }
    eligible.push(e);
  }
  eligible.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.eventId.localeCompare(b.eventId));
  excluded.sort((a, b) => (a.eventId ?? '').localeCompare(b.eventId ?? '') || a.reason.localeCompare(b.reason));
  return { eligible, excluded };
}

/** The viewer's own current intents for eligible events. A duplicated or malformed row fails closed for that event. */
function currentViewerIntents(rows: readonly unknown[], eligible: Set<string>, now: number): Map<string, PublishedEventIntent> {
  const seen = new Map<string, PublishedEventIntent | null>();
  for (const r of rows) {
    const id = idOf(r);
    if (id === null) continue;
    const ok = isObj(r) && onlyKeys(r, INTENT_KEYS) && (EVENT_INTENT_KINDS as readonly unknown[]).includes(r.kind) &&
      Number.isSafeInteger(r.version) && (r.version as number) > 0 && r.active === true && isTime(r.expiresAt) &&
      Date.parse(r.expiresAt) > now;
    seen.set(id, ok && !seen.has(id) ? { eventId: id, intent: r.kind as PublishedEventIntent['intent'], expiresAt: r.expiresAt as string } : null);
  }
  return new Map([...seen].filter((e): e is [string, PublishedEventIntent] => e[1] !== null && eligible.has(e[0])));
}

/**
 * For each eligible event the viewer currently intends, the visible people the server paired with the viewer for
 * that event, ranked by rankNearby event mode. No suggestion unless the server says the intent is mutual.
 */
export function rankEventCompanions(input: EventCompanionInput): EventShortlist {
  const now = input.now.getTime();
  const { eligible, excluded } = eligibleEvents(input.catalogue, input.viewerAreaKey, input.allowedTags, input.now);
  const withheld: Diagnostics['withheld'] = [];
  const { candidates: cards } = fromDiscoveryCards(input.cards, input.viewer.tags, input.allowedTags);
  const diag = (candidates: DiscoveryCandidate[]): Diagnostics =>
    ({ eligibility: { eligible: eligible.map(e => e.eventId), excluded }, withheld, candidates });
  const none = (reason: EventNoResultReason, candidates: DiscoveryCandidate[] = []): EventShortlist =>
    ({ kind: 'none', reason, ...diag(candidates) });

  if (!input.viewer.published) return none('not_published');
  if (!validAreaKey(input.viewerAreaKey)) return none('no_active_area');
  if (eligible.length === 0) return none('no_eligible_event');
  const mine = currentViewerIntents(input.myIntents, new Set(eligible.map(e => e.eventId)), now);
  if (mine.size === 0) return none('viewer_no_event_intent');

  const byRef = new Map(cards.map(c => [c.ref, new Set<string>()]));
  for (const row of input.companions) {
    const cardRef = isObj(row) && typeof row.cardRef === 'string' && row.cardRef.length <= MAX_REF ? row.cardRef : null;
    const eventId = idOf(row);
    if (!isObj(row) || !onlyKeys(row, COMPANION_KEYS) || cardRef === null || eventId === null) {
      withheld.push({ cardRef, eventId, reason: 'invalid_companion' }); continue;
    }
    if (!mine.has(eventId)) { withheld.push({ cardRef, eventId, reason: 'not_mutual_here' }); continue; }
    const events = byRef.get(cardRef);
    if (!events) { withheld.push({ cardRef, eventId, reason: 'card_not_visible' }); continue; }
    events.add(eventId);
  }
  withheld.sort((a, b) => (a.cardRef ?? '').localeCompare(b.cardRef ?? '') || (a.eventId ?? '').localeCompare(b.eventId ?? '') ||
    a.reason.localeCompare(b.reason));
  const candidates = cards.map(c => ({ ...c, sharedEventIds: [...byRef.get(c.ref)!].sort() }))
    .sort((a, b) => a.ref.localeCompare(b.ref));

  const viewer: DiscoveryViewer = { ...input.viewer, eventIntents: [...mine.values()] };
  const results: EventCompanions[] = [];
  for (const e of eligible) {
    const intent = mine.get(e.eventId);
    if (!intent) continue;
    const r: DiscoveryShortlist = rankNearby({ viewer, candidates, allowedTags: input.allowedTags, now: input.now,
      mode: { kind: 'event', eventId: e.eventId, eventTags: e.topics }, limit: SHORTLIST_SIZE });
    const companions = r.kind === 'shortlist' ? r.entries.filter(x => x.sharedEventId === e.eventId) : [];
    if (companions.length > 0) results.push({ eventId: e.eventId, viewerIntent: intent.intent, companions });
  }
  if (results.length === 0) return none('no_companions', candidates);
  return { kind: 'events', events: results.slice(0, input.limit ?? MAX_EVENTS), ...diag(candidates) };
}
