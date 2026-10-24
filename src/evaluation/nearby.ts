/**
 * DS nearby/event shortlist (DS-R1/R2). Pure and deterministic: no I/O, no clock reads, no provider calls.
 *
 * Input is the authorized candidate page the server already filtered by publication, area, audience and block
 * state (C8). This function re-applies every eligibility flag it can see and never relaxes one; it only removes and
 * orders. Overlap uses published tags of both people and, for events, the viewer's own current intents intersected
 * with the server-authorized mutual `sharedEventIds` (D039: another person's intent kind and expiry are never an
 * input or an output). Display names are untrusted text and are never read for ranking. Cards carrying any field outside the projection (coordinates, distance,
 * private context) are rejected rather than ignored, so a projection bug fails visibly.
 */
import type {
  DiscoveryCandidate, DiscoveryMode, DiscoveryShortlist, DiscoveryViewer, ExclusionReason, NoShortlistReason,
  PublishedEventIntent, ReasonCode, ShortlistEntry,
} from '../features/discovery/types.ts';
import { DISCOVERY_CARD_LIMIT, MAX_INTEREST_TAGS, MAX_PUBLIC_NAME } from '@dor/contracts/policy';

/** Initial proposals from docs/features/LOCAL_CONNECTIONS.md; benchmarks, not measured capacity. */
export const MAX_CANDIDATES = DISCOVERY_CARD_LIMIT;
export const SHORTLIST_SIZE = 3;
export const SAME_EVENT_SCORE = 2;
export const EVENT_FITS_SCORE = 1;

const CARD_KEYS = new Set(['ref', 'displayName', 'avatarMediaId', 'tags', 'sharedEventIds', 'publicationVersion',
  'publicationExpiresAt', 'withdrawn', 'blocked', 'alreadyConnected']);
const INTENT_KEYS = new Set(['eventId', 'intent', 'expiresAt']);
/** Same slug shape as Cyber's catalogue topic and C8 publication allowlists (contracts/src/{catalogue,discovery}.ts). */
const TAG_RE = /^[a-z][a-z0-9-]{1,31}$/;
/** Name and tag bounds are the C8 publication limits, so nothing the server would refuse can rank. */
const MAX_REF = 128, MAX_NAME = MAX_PUBLIC_NAME, MAX_TAGS = MAX_INTEREST_TAGS, MAX_INTENTS = 10;

export interface NearbyInput {
  viewer: DiscoveryViewer;
  /** Untrusted authorized candidate rows. */
  candidates: unknown[];
  mode: DiscoveryMode;
  /** Developer-configured discovery tag allowlist (never user-supplied). */
  allowedTags: string[];
  now: Date;
  limit?: number;
}

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isTime = (v: unknown): v is string => isStr(v, 64) && Number.isFinite(Date.parse(v));
const onlyKeys = (o: object, keys: Set<string>) => Object.keys(o).every(k => keys.has(k));

function validIntent(v: unknown): v is PublishedEventIntent {
  if (typeof v !== 'object' || v === null || !onlyKeys(v, INTENT_KEYS)) return false;
  const i = v as Record<string, unknown>;
  return isStr(i.eventId, MAX_REF) && (i.intent === 'interested' || i.intent === 'going') && isTime(i.expiresAt);
}

function validEventIds(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= MAX_INTENTS && new Set(v).size === v.length && v.every(id => isStr(id, MAX_REF));
}

function validTags(v: unknown, allowed: Set<string>): v is string[] {
  return Array.isArray(v) && v.length <= MAX_TAGS && new Set(v).size === v.length &&
    v.every(t => typeof t === 'string' && TAG_RE.test(t) && allowed.has(t));
}

/** Strict shape check: unknown keys, unallowlisted tags or out-of-range values reject the whole card. */
export function parseCandidate(raw: unknown, allowedTags: Set<string>): DiscoveryCandidate | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !onlyKeys(raw, CARD_KEYS)) return null;
  const c = raw as Record<string, unknown>;
  const ok = isStr(c.ref, MAX_REF) && isStr(c.displayName, MAX_NAME) &&
    (c.avatarMediaId === null || isStr(c.avatarMediaId, MAX_REF)) && validTags(c.tags, allowedTags) &&
    validEventIds(c.sharedEventIds) &&
    Number.isSafeInteger(c.publicationVersion) && (c.publicationVersion as number) > 0 && (c.publicationExpiresAt === null || isTime(c.publicationExpiresAt)) &&
    typeof c.withdrawn === 'boolean' && typeof c.blocked === 'boolean' && typeof c.alreadyConnected === 'boolean';
  return ok ? (raw as DiscoveryCandidate) : null;
}

const currentIntents = (intents: PublishedEventIntent[], now: number) => intents.filter(i => Date.parse(i.expiresAt) > now);
const refOf = (raw: unknown) => (typeof raw === 'object' && raw !== null && isStr((raw as { ref?: unknown }).ref, MAX_REF)
  ? (raw as { ref: string }).ref : null);

export function rankNearby(input: NearbyInput): DiscoveryShortlist {
  const mode = input.mode.kind;
  const excluded: { ref: string | null; reason: ExclusionReason }[] = [];
  let truncated = false;
  const none = (reason: NoShortlistReason): DiscoveryShortlist => ({ kind: 'none', mode, reason, excluded, truncated });

  const now = input.now.getTime();
  const allowed = new Set(input.allowedTags.filter(t => TAG_RE.test(t)));
  const viewer = input.viewer;
  if (!viewer.published) return none('not_published');
  const viewerTags = new Set(viewer.tags.filter(t => allowed.has(t)));
  const viewerEvents = new Map(currentIntents(viewer.eventIntents.filter(validIntent), now).map(i => [i.eventId, i]));
  if (viewerTags.size === 0 && viewerEvents.size === 0) return none('viewer_has_nothing_published');
  if (input.mode.kind === 'event' && !viewerEvents.has(input.mode.eventId)) return none('viewer_no_event_intent');

  // Order-independent: sort by ref before capping so the same set always yields the same page.
  const rows = [...input.candidates].sort((a, b) => (refOf(a) ?? '').localeCompare(refOf(b) ?? ''));
  const seen = new Set<string>();
  const eligible: DiscoveryCandidate[] = [];
  let considered = 0;
  for (const raw of rows) {
    const c = parseCandidate(raw, allowed);
    const out = (reason: ExclusionReason) => excluded.push({ ref: c?.ref ?? refOf(raw), reason });
    if (!c) { out('invalid_card'); continue; }
    if (seen.has(c.ref)) { out('duplicate'); continue; }
    seen.add(c.ref);
    if (considered >= MAX_CANDIDATES) { truncated = true; out('over_cap'); continue; }
    considered++;
    if (c.ref === viewer.ref) { out('self'); continue; }
    if (c.blocked) { out('blocked'); continue; }
    if (c.withdrawn) { out('withdrawn'); continue; }
    if (c.publicationExpiresAt !== null && Date.parse(c.publicationExpiresAt) <= now) { out('expired_publication'); continue; }
    if (c.alreadyConnected) { out('already_connected'); continue; }
    if (input.mode.kind === 'event') {
      const eventId = input.mode.eventId;
      if (!c.sharedEventIds.includes(eventId)) { out('no_event_intent'); continue; }
    }
    eligible.push(c);
  }
  if (eligible.length === 0) return none('empty_area');

  const eventTags = input.mode.kind === 'event' ? new Set(input.mode.eventTags) : new Set<string>();
  const scored = eligible.map(c => {
    const sharedTags = c.tags.filter(t => viewerTags.has(t)).sort();
    const mutual = c.sharedEventIds.filter(id => viewerEvents.has(id)).sort();
    const shared = input.mode.kind === 'event'
      ? mutual.find(id => id === (input.mode as { eventId: string }).eventId) ?? null
      : mutual[0] ?? null;
    const reasons: ReasonCode[] = [];
    let score = sharedTags.length;
    if (sharedTags.length > 0) reasons.push('shared_interest');
    if (shared) { score += SAME_EVENT_SCORE; reasons.push('same_event'); }
    if (sharedTags.some(t => eventTags.has(t))) { score += EVENT_FITS_SCORE; reasons.push('event_fits_shared_interest'); }
    const entry: ShortlistEntry = { ref: c.ref, reasons, sharedTags, sharedEventId: shared };
    return { entry, score };
  }).filter(s => s.score > 0);
  if (scored.length === 0) return none('no_fit');
  scored.sort((a, b) => b.score - a.score || a.entry.ref.localeCompare(b.entry.ref));
  return { kind: 'shortlist', mode, excluded, truncated,
    entries: scored.slice(0, input.limit ?? SHORTLIST_SIZE).map(s => s.entry) };
}

/** Comparison baseline only (never ship): most raw tag overlap, no eligibility filtering or validation. */
export function mostTagsBaseline(input: NearbyInput): DiscoveryShortlist {
  const mode = input.mode.kind;
  const vt = new Set(input.viewer.tags);
  const rows = input.candidates.filter((r): r is DiscoveryCandidate => typeof r === 'object' && r !== null && Array.isArray((r as DiscoveryCandidate).tags))
    .map(c => ({ c, n: c.tags.filter(t => vt.has(t)).length })).filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n || String(a.c.ref).localeCompare(String(b.c.ref)));
  if (rows.length === 0) return { kind: 'none', mode, reason: 'no_fit', excluded: [], truncated: false };
  return { kind: 'shortlist', mode, excluded: [], truncated: false, entries: rows.slice(0, input.limit ?? SHORTLIST_SIZE)
    .map(({ c }) => ({ ref: String(c.ref), reasons: ['shared_interest'], sharedTags: c.tags.filter(t => vt.has(t)).sort(),
      sharedEventId: null })) };
}
