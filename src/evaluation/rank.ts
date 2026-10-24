/**
 * DS ranking: pure and deterministic (no I/O, no clock reads, no provider calls).
 *
 * - rankAckOptions: the `rank` hook for AI's BoundedCoordinator. It can reorder or drop options; it never adds one,
 *   and the coordinator ignores anything that was not in its input anyway. Inputs are the approved envelope and
 *   the options the recipient's consent already permits, so no local profile, quiz extra or journal data is needed.
 * - rankActivities: orders public catalogue items for an option both people already agreed to. Catalogue rows
 *   are untrusted data: title/summary are never read for scoring, and output carries only stable IDs and codes.
 *   Interests count only when both people approved them; one person's interest is never assumed to be shared.
 *
 * ActivityItem is a DS consumer proposal for the planned C7 `ActivityCatalogueItem` (docs/features/ACTIVITY_DISCOVERY.md).
 * It is not a contract type; replace it with the C7 import once CS/Cyber land the reviewed schema.
 */
import type { ApprovedSignal, Availability, SupportMode } from '@kinetic/contracts';

/** Structurally identical to AI's `AckOption` (src/agents coordination); redeclared to import only contracts. */
export interface AckOption { supportMode: SupportMode; availability?: Availability }

/** Most actionable first: a nudge lives at most 24h, so a same-day window can be acted on before it expires. */
const WINDOW_ORDER: Record<string, number> = { today: 0, this_week: 1, no_preference: 2 };
const windowRank = (w: Availability | undefined) => (w === undefined ? 3 : WINDOW_ORDER[w] ?? 3);

const narrows = (approved: Availability, option: Availability) =>
  approved === 'no_preference' || option === approved || (approved === 'this_week' && option === 'today');

/**
 * Coordinator rank hook: `(options, signal) => options`. Drops duplicates, options for another mode and windows
 * broader than (or absent from) what the sender approved; orders by window specificity, keeping the recipient's
 * order on ties.
 */
export function rankAckOptions(options: AckOption[], signal: ApprovedSignal): AckOption[] {
  const seen = new Set<string>();
  const kept: { option: AckOption; index: number }[] = [];
  options.forEach((option, index) => {
    const key = `${option.supportMode}|${option.availability ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (option.supportMode !== signal.supportMode) return;
    if (option.availability !== undefined &&
      (signal.availability === undefined || !narrows(signal.availability, option.availability))) return;
    kept.push({ option, index });
  });
  kept.sort((a, b) => windowRank(a.option.availability) - windowRank(b.option.availability) || a.index - b.index);
  return kept.map(k => ({ ...k.option }));
}

// ---- Activity ranking (C7 consumer proposal) ----

export const ACTIVITY_CATEGORIES = ['games', 'watching_together', 'creating', 'talking', 'learning', 'music', 'fitness', 'other'] as const;
export type ActivityCategory = typeof ACTIVITY_CATEGORIES[number];

export type ActivitySchedule =
  | { kind: 'scheduled'; startAt: string; endAt: string | null }
  | { kind: 'on_demand' }
  | { kind: 'unknown' };

export interface ActivityItem {
  activityId: string;
  sourceUrl: string;
  sourceSite: string;
  title: string;
  summary: string;
  format: 'online' | 'in_person';
  categories: ActivityCategory[];
  schedule: ActivitySchedule;
  durationMinutes: number | null;
  fetchedAt: string;
  freshness: 'fresh' | 'cached' | 'expired';
}

export type RationaleCode = 'scheduled_moment' | 'on_demand' | 'short_duration' | 'mutual_interest' | 'cached_source';
export type ExclusionReason =
  | 'invalid_item' | 'unsafe_url' | 'source_not_allowed' | 'format_out_of_scope' | 'expired_source' | 'duplicate'
  | 'time_unverified' | 'already_started' | 'starts_too_soon' | 'outside_window';
export type NoSuggestionReason =
  | 'no_agreed_option' | 'not_shared_activity' | 'empty_catalogue' | 'no_eligible_activity' | 'no_strong_match';

export interface ActivitySuggestion { activityId: string; score: number; rationale: RationaleCode[] }
export interface Exclusion { activityId: string | null; reason: ExclusionReason }
export type ActivityRankResult =
  | { kind: 'ranked'; suggestions: ActivitySuggestion[]; excluded: Exclusion[] }
  | { kind: 'no_suggestion'; reason: NoSuggestionReason; excluded: Exclusion[] };

export interface ActivityRankInput {
  /** The option both sides agreed to (matched nudge / compatible ACK), or null. Callers pass it only after policy and ACK. */
  agreed: AckOption | null;
  /** Untrusted normalized catalogue rows from CS. */
  catalogue: unknown[];
  /**
   * Each person's approved activity interests, from a reviewed C7 consent record only. Null until that consent exists.
   * Quiz Q5 extras are local vault data and must never be passed here.
   */
  approvedInterests: { sender: ActivityCategory[]; recipient: ActivityCategory[] } | null;
  now: Date;
  /** Recipient's UTC offset as captured with their quiet hours (D018); defines the end of "today". */
  utcOffsetMinutes: number;
  /** Developer-configured source sites (never model-supplied). */
  allowedSourceSites: string[];
  limit?: number;
}

export const MIN_LEAD_MS = 30 * 60 * 1000;
export const MAX_SOURCE_AGE_MS = 72 * 60 * 60 * 1000;
export const HORIZON_MS = 14 * 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const SHORT_DURATION_MINUTES = 90;
/** Below this the item is not worth an interruption: e.g. an on-demand item of unknown or long duration. */
export const MIN_SCORE = 2;
export const DEFAULT_LIMIT = 3;
const MAX_ID = 128;

const isStr = (v: unknown, max = 2048): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isTime = (v: unknown): v is string => isStr(v, 64) && Number.isFinite(Date.parse(v));
const isCategory = (v: unknown): v is ActivityCategory => (ACTIVITY_CATEGORIES as readonly unknown[]).includes(v);

/** Shape check only; anything unexpected rejects the row rather than being repaired. */
export function parseActivityItem(raw: unknown): ActivityItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const s = r.schedule as Record<string, unknown> | null | undefined;
  const scheduleOk = typeof s === 'object' && s !== null && (
    (s.kind === 'scheduled' && isTime(s.startAt) && (s.endAt === null || isTime(s.endAt))) ||
    s.kind === 'on_demand' || s.kind === 'unknown');
  const ok = isStr(r.activityId, MAX_ID) && isStr(r.sourceUrl) && isStr(r.sourceSite, 253) &&
    typeof r.title === 'string' && typeof r.summary === 'string' &&
    (r.format === 'online' || r.format === 'in_person') &&
    Array.isArray(r.categories) && r.categories.every(isCategory) && scheduleOk &&
    (r.durationMinutes === null || (Number.isSafeInteger(r.durationMinutes) && (r.durationMinutes as number) > 0)) &&
    isTime(r.fetchedAt) && (r.freshness === 'fresh' || r.freshness === 'cached' || r.freshness === 'expired');
  return ok ? (raw as ActivityItem) : null;
}

/** https only, no credentials, host must equal the declared source site. Returns the dedupe key or null. */
function canonicalUrl(item: ActivityItem): string | null {
  let url: URL;
  try {
    url = new URL(item.sourceUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname !== item.sourceSite.toLowerCase()) return null;
  return `${url.hostname}${url.pathname.replace(/\/+$/, '')}`;
}

/** End of the recipient's local calendar day, as a UTC epoch. */
function endOfLocalDay(now: Date, offsetMinutes: number): number {
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  local.setUTCHours(24, 0, 0, 0);
  return local.getTime() - offsetMinutes * 60_000;
}

function windowEnd(window: Availability | undefined, now: Date, offset: number): number {
  if (window === 'today') return endOfLocalDay(now, offset);
  if (window === 'this_week') return now.getTime() + WEEK_MS;
  return now.getTime() + HORIZON_MS;
}

const startOf = (item: ActivityItem) => (item.schedule.kind === 'scheduled' ? Date.parse(item.schedule.startAt) : Infinity);

export function rankActivities(input: ActivityRankInput): ActivityRankResult {
  const excluded: Exclusion[] = [];
  const none = (reason: NoSuggestionReason): ActivityRankResult => ({ kind: 'no_suggestion', reason, excluded });
  if (input.agreed === null) return none('no_agreed_option');
  if (input.agreed.supportMode !== 'shared_activity') return none('not_shared_activity');
  if (input.catalogue.length === 0) return none('empty_catalogue');

  const now = input.now.getTime();
  const end = windowEnd(input.agreed.availability, input.now, input.utcOffsetMinutes);
  const allowedSites = new Set(input.allowedSourceSites.map(s => s.toLowerCase()));
  const mutual = input.approvedInterests === null ? new Set<ActivityCategory>() :
    new Set(input.approvedInterests.sender.filter(c => input.approvedInterests!.recipient.includes(c)));

  // Freshest first so dedupe keeps the most recent observation of the same listing.
  const parsed: { item: ActivityItem; key: string }[] = [];
  for (const raw of input.catalogue) {
    const item = parseActivityItem(raw);
    const id = item?.activityId ?? (isStr((raw as { activityId?: unknown } | null)?.activityId, MAX_ID)
      ? (raw as { activityId: string }).activityId : null);
    const out = (reason: ExclusionReason) => excluded.push({ activityId: id, reason });
    if (!item) { out('invalid_item'); continue; }
    const key = canonicalUrl(item);
    if (key === null) { out('unsafe_url'); continue; }
    if (!allowedSites.has(item.sourceSite.toLowerCase())) { out('source_not_allowed'); continue; }
    if (item.format !== 'online') { out('format_out_of_scope'); continue; }
    if (item.freshness === 'expired' || now - Date.parse(item.fetchedAt) > MAX_SOURCE_AGE_MS) { out('expired_source'); continue; }
    if (item.schedule.kind === 'unknown') { out('time_unverified'); continue; }
    if (item.schedule.kind === 'scheduled') {
      const start = startOf(item);
      if (start <= now) { out('already_started'); continue; }
      if (start - now < MIN_LEAD_MS) { out('starts_too_soon'); continue; }
      if (start >= end) { out('outside_window'); continue; }
    }
    parsed.push({ item, key });
  }
  parsed.sort((a, b) => Date.parse(b.item.fetchedAt) - Date.parse(a.item.fetchedAt) || a.item.activityId.localeCompare(b.item.activityId));
  const keys = new Set<string>(), ids = new Set<string>();
  const eligible: ActivityItem[] = [];
  for (const { item, key } of parsed) {
    if (keys.has(key) || ids.has(item.activityId)) { excluded.push({ activityId: item.activityId, reason: 'duplicate' }); continue; }
    keys.add(key); ids.add(item.activityId);
    eligible.push(item);
  }
  if (eligible.length === 0) return none('no_eligible_activity');

  const scored = eligible.map(item => {
    const rationale: RationaleCode[] = [];
    let score = 0;
    if (item.schedule.kind === 'scheduled') { score += 2; rationale.push('scheduled_moment'); }
    else { score += 1; rationale.push('on_demand'); }
    if (item.durationMinutes !== null && item.durationMinutes <= SHORT_DURATION_MINUTES) { score += 1; rationale.push('short_duration'); }
    if (item.categories.some(c => mutual.has(c))) { score += 3; rationale.push('mutual_interest'); }
    if (item.freshness === 'cached') { score -= 1; rationale.push('cached_source'); }
    return { item, score, rationale };
  });
  scored.sort((a, b) => b.score - a.score || startOf(a.item) - startOf(b.item) || a.item.activityId.localeCompare(b.item.activityId));
  const strong = scored.filter(s => s.score >= MIN_SCORE);
  if (strong.length === 0) return none('no_strong_match');
  return {
    kind: 'ranked', excluded,
    suggestions: strong.slice(0, input.limit ?? DEFAULT_LIMIT)
      .map(s => ({ activityId: s.item.activityId, score: s.score, rationale: s.rationale })),
  };
}

/**
 * Comparison baseline only (never ship): soonest upcoming or on-demand item, with no source, format, freshness,
 * window, dedupe or strength checks.
 */
export function soonestFirstBaseline(input: ActivityRankInput): ActivityRankResult {
  if (input.agreed === null) return { kind: 'no_suggestion', reason: 'no_agreed_option', excluded: [] };
  if (input.agreed.supportMode !== 'shared_activity') return { kind: 'no_suggestion', reason: 'not_shared_activity', excluded: [] };
  const items = input.catalogue.map(parseActivityItem).filter((i): i is ActivityItem => i !== null)
    .filter(i => i.schedule.kind === 'on_demand' || startOf(i) > input.now.getTime())
    .sort((a, b) => startOf(a) - startOf(b) || a.activityId.localeCompare(b.activityId));
  if (items.length === 0) return { kind: 'no_suggestion', reason: 'empty_catalogue', excluded: [] };
  return { kind: 'ranked', excluded: [], suggestions: items.slice(0, input.limit ?? DEFAULT_LIMIT)
    .map(i => ({ activityId: i.activityId, score: 0, rationale: [] })) };
}
