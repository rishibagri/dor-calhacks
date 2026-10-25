/**
 * Google sources for the window (D051 proposal; docs/features/APIFY_SOURCES.md). Server-only, like the rest of this
 * folder. Inputs come only from the fixed tables below (allowlisted kinds/topics × configured launch areas), never
 * from a user or device. Outputs read an explicit allowlist of public fields: no reviews, reviewer names, phone,
 * website contacts, opening hours, coordinates or descriptions leave this module.
 *
 *  - Places: `compass/crawler-google-places` → `upsert_catalogue_place`. Area from the place's public coordinates.
 *  - Events: Google's events panel via `johnvc/google-events-api…` → `upsert_catalogue_event`. That source gives no
 *    coordinates (`address` is `[venue, "City, ST"]`), so the area comes from a simple address rule: a ZIP code
 *    when present, otherwise the city (Berkeley → Downtown Berkeley, San Francisco → SoMa). Coarse on purpose.
 */
import { createHash } from 'node:crypto';
import { guardCatalogueEvent, guardCataloguePlace, type PlaceKind } from '@dor/contracts/policy';
import { looksLikeInstruction, type UpsertArgs } from '../../lib/catalogue/ingest.ts';
import { areaForVenue, toUtcMs } from './normalize.ts';
import type { FetchLike } from './apify.ts';

export const GOOGLE_MAPS = { actor: 'compass~crawler-google-places', build: '0.14.775' } as const;
export const GOOGLE_EVENTS = { actor: 'johnvc~google-events-api---access-google-events-data', build: '0.0.304' } as const;
export const PLACE_HOSTS = ['google.com'] as const;
const ZONE = 'America/Los_Angeles';

/** Where each launch area is searched. Text describes a public neighbourhood, never a person. */
export const AREA_QUERY: Record<string, { near: string; city: string }> = {
  'berkeley-campus': { near: 'Telegraph Avenue near UC Berkeley', city: 'Berkeley, CA' },
  'berkeley-downtown': { near: 'Downtown Berkeley', city: 'Berkeley, CA' },
  'sf-mission': { near: 'Mission District', city: 'San Francisco, CA' },
  'sf-soma': { near: 'SoMa', city: 'San Francisco, CA' },
};
export const PLACE_QUERY: Record<PlaceKind, string> = {
  food: 'restaurants', coffee: 'coffee shops', dessert: 'dessert', study: 'cafes to study', bar: 'bars', park: 'parks',
  books: 'bookstores', museum: 'museums', fitness: 'climbing gyms and yoga studios', music: 'live music venues', art: 'art galleries',
  games: 'board game cafes and arcades',
};
/** Places below this are not suggested: a few glowing reviews are not a signal. */
export const PLACE_MIN_REVIEWS = 30;
export const PLACE_MIN_RATING_TENTHS = 40;

export interface PlaceArgs {
  place_id: string; name: string; kind: PlaceKind; label: string; rating_tenths: number; review_count: number;
  area_key: string; source_url: string | null; fetched_at: string;
}
export type Rejected = { index: number; reason: string };
/** D057 matching text for an upserted item (same scrape). Cleaned again by guardCatalogueDetail in the module. */
export interface DetailArgs {
  item_id: string; item_kind: 'event' | 'place'; summary: string; keywords: string[]; price_label: string; venue: string; fetched_at: string;
}
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const short = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
const hashId = (prefix: string, ...parts: string[]) => `${prefix}:${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24)}`;

/** One capped, synchronous Actor run on a pinned build. The token goes in a header only. */
export async function runActor(actor: { actor: string; build: string }, input: Record<string, unknown>, token: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 240_000): Promise<unknown[]> {
  const res = await fetchImpl(`https://api.apify.com/v2/acts/${actor.actor}/run-sync-get-dataset-items?build=${encodeURIComponent(actor.build)}&timeout=${Math.floor(timeoutMs / 1000)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs + 10_000),
  });
  if (!res.ok) throw new Error(`Apify ${actor.actor} returned HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error(`Apify ${actor.actor} dataset was not an array`);
  return json;
}

// ---------- places ----------

export function placesInput(kind: PlaceKind, areaKey: string, max: number): Record<string, unknown> {
  const q = AREA_QUERY[areaKey];
  if (!q) throw new Error(`no place query for area ${areaKey}`);
  return { searchStringsArray: [`${PLACE_QUERY[kind]} ${q.near}`], locationQuery: q.city, maxCrawledPlacesPerSearch: max, language: 'en',
    skipClosedPlaces: true, scrapePlaceDetailPage: false, maxReviews: 0, maxImages: 0, scrapeContacts: false };
}

/** Raw Google Maps items → place upserts. Area from coordinates against the launch areas; nothing else is read. */
export function normalizePlaces(items: readonly unknown[], kind: PlaceKind, ctx: { areaKeys: readonly string[]; fetchedAtMs: number; nowMs: number }) {
  const upserts: PlaceArgs[] = [], rejected: Rejected[] = [], seen = new Set<string>(), details: DetailArgs[] = [];
  items.forEach((raw, index) => {
    const i = obj(raw), loc = obj(i.location);
    const drop = (reason: string) => { rejected.push({ index, reason }); };
    if (i.permanentlyClosed === true || i.temporarilyClosed === true) return drop('closed');
    if (typeof i.placeId !== 'string' || typeof i.title !== 'string') return drop('invalid');
    if (looksLikeInstruction(i.title)) return drop('instruction_like_title');
    const rating = typeof i.totalScore === 'number' ? Math.round(i.totalScore * 10) : null;
    const reviews = typeof i.reviewsCount === 'number' ? Math.floor(i.reviewsCount) : null;
    if (rating === null || reviews === null || rating < PLACE_MIN_RATING_TENTHS || reviews < PLACE_MIN_REVIEWS) return drop('too_few_or_low_reviews');
    const areaKey = areaForVenue(loc.lat, loc.lng, ctx.areaKeys);
    if (!areaKey) return drop('outside_region');
    const id = hashId('gmp', i.placeId);
    if (seen.has(id)) return drop('duplicate');
    const args: PlaceArgs = { place_id: id, name: i.title, kind, label: typeof i.categoryName === 'string' ? i.categoryName : '',
      rating_tenths: rating, review_count: reviews, area_key: areaKey, source_url: typeof i.url === 'string' ? i.url : null,
      fetched_at: new Date(ctx.fetchedAtMs).toISOString() };
    const g = guardCataloguePlace({ placeId: args.place_id, name: args.name, kind, label: args.label, ratingTenths: rating, reviewCount: reviews,
      areaKey, sourceUrl: args.source_url, fetchedAtMs: ctx.fetchedAtMs }, { areas: ctx.areaKeys, hosts: PLACE_HOSTS }, ctx.nowMs);
    if (!g.ok) return drop(g.reason);
    seen.add(id);
    upserts.push({ ...args, name: g.place.name, label: g.place.label, source_url: g.place.sourceUrl });
    const cats = [...new Set([i.categoryName, ...strList(i.categories)].filter((x): x is string => typeof x === 'string'))];
    details.push({ item_id: id, item_kind: 'place', fetched_at: args.fetched_at, venue: g.place.name, price_label: short(i.price, 20),
      summary: short([cats.slice(0, 4).join(', '), typeof i.neighborhood === 'string' ? `in ${i.neighborhood}` : '', short(i.description, 200)].filter(Boolean).join(' · '), 280),
      keywords: [kind, ...cats] });
  });
  return { upserts, rejected, details };
}

// ---------- events (Google's events panel) ----------

export const EVENT_CITIES = ['Berkeley', 'San Francisco'] as const;

export function googleEventsInput(topic: string, city: (typeof EVENT_CITIES)[number]): Record<string, unknown> {
  return { q: `${topic.replace(/-/g, ' ')} events in ${city}`, location: `${city}, California, United States`, gl: 'us', hl: 'en', max_pages: 1 };
}

/** ZIP → area (first match wins), then city → area. Coarse by design; anything else is dropped. */
const ZIP_AREA: Record<string, string> = {
  '94720': 'berkeley-campus', '94704': 'berkeley-campus',
  '94709': 'berkeley-downtown', '94710': 'berkeley-downtown', '94702': 'berkeley-downtown', '94703': 'berkeley-downtown',
  '94110': 'sf-mission',
  '94103': 'sf-soma', '94105': 'sf-soma', '94107': 'sf-soma', '94102': 'sf-soma', '94104': 'sf-soma', '94108': 'sf-soma', '94111': 'sf-soma', '94158': 'sf-soma',
};
const CITY_AREA: Record<string, string> = { berkeley: 'berkeley-downtown', 'san francisco': 'sf-soma' };

export function areaForAddress(address: unknown, areaKeys: readonly string[]): string | null {
  if (!Array.isArray(address)) return null;
  const text = address.filter((x): x is string => typeof x === 'string').join(', ');
  for (const zip of text.match(/\b9\d{4}\b/g) ?? []) { const a = ZIP_AREA[zip]; if (a && areaKeys.includes(a)) return a; }
  const city = /([A-Za-z .]+),\s*CA\b/.exec(text)?.[1]?.trim().toLowerCase();
  const a = city ? CITY_AREA[city] : undefined;
  return a && areaKeys.includes(a) ? a : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/**
 * "Oct 29, 7:00 PM", "Sat, Nov 1, 8 – 11 PM", "Nov 1, 8 PM – Nov 2, 2 AM" → start (UTC ms), Bay Area local time. The year is the
 * one that puts the date closest to now. No clock time → null (an event is never guessed into a time slot).
 */
export function parseWhen(when: unknown, nowMs: number): number | null {
  if (typeof when !== 'string') return null;
  const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*[–-]\s*\d{1,2}(?::\d{2})?\s*(am|pm))?/i.exec(when);
  if (!m) return null;
  const meridiem = (m[5] ?? m[6])?.toLowerCase();
  if (!meridiem) return null;
  let hour = Number(m[3]) % 12;
  if (meridiem === 'pm') hour += 12;
  const month = MONTHS.indexOf(m[1]!.toLowerCase()), day = Number(m[2]), minute = Number(m[4] ?? 0);
  const year = new Date(nowMs).getUTCFullYear();
  const pad = (n: number) => String(n).padStart(2, '0');
  const candidates = [year - 1, year, year + 1].map((y) => toUtcMs(`${y}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`, ZONE))
    .filter((x): x is number => x !== null);
  return candidates.sort((a, b) => Math.abs(a - nowMs) - Math.abs(b - nowMs))[0] ?? null;
}

/** Raw Google Events dataset (pages with an `events` array) → event upserts for one query topic. */
export function normalizeGoogleEvents(pages: readonly unknown[], topic: string,
  ctx: { tags: readonly string[]; areaKeys: readonly string[]; hosts: readonly string[]; fetchedAtMs: number; nowMs: number; windowDays: number }) {
  const upserts: UpsertArgs[] = [], rejected: Rejected[] = [], seen = new Set<string>(), details: DetailArgs[] = [];
  let index = -1;
  for (const page of pages) {
    const events = obj(page).events;
    for (const raw of Array.isArray(events) ? events : []) {
      index += 1;
      const e = obj(raw), drop = (reason: string) => { rejected.push({ index, reason }); };
      if (typeof e.title !== 'string' || looksLikeInstruction(e.title)) { drop('invalid_title'); continue; }
      const startsAtMs = parseWhen(obj(e.date).when, ctx.nowMs);
      if (startsAtMs === null) { drop('no_time'); continue; }
      if (startsAtMs <= ctx.nowMs || startsAtMs > ctx.nowMs + ctx.windowDays * 86_400_000) { drop('outside_window'); continue; }
      const areaKey = areaForAddress(e.address, ctx.areaKeys);
      if (!areaKey) { drop('outside_region'); continue; }
      const venue = Array.isArray(e.address) && typeof e.address[0] === 'string' ? e.address[0] : '';
      const id = hashId('gev', e.title.toLowerCase(), String(startsAtMs), venue.toLowerCase());
      if (seen.has(id)) { drop('duplicate'); continue; }
      const args: UpsertArgs = { event_id: id, title: e.title, starts_at: new Date(startsAtMs).toISOString(), ends_at: null, status: 'scheduled',
        fetched_at: new Date(ctx.fetchedAtMs).toISOString(), topics: [topic], format: 'in_person', area_key: areaKey,
        source_url: typeof e.link === 'string' && ctx.hosts.some((h) => { try { const host = new URL(e.link as string).hostname; return host === h || host.endsWith('.' + h); } catch { return false; } }) ? e.link : null };
      const g = guardCatalogueEvent({ eventId: args.event_id, title: args.title, startsAtMs, endsAtMs: null, status: 'scheduled', fetchedAtMs: ctx.fetchedAtMs,
        topics: args.topics, format: 'in_person', areaKey, sourceUrl: args.source_url }, { tags: ctx.tags, areas: ctx.areaKeys, hosts: ctx.hosts }, ctx.nowMs);
      if (!g.ok) { drop(g.reason); continue; }
      seen.add(id);
      upserts.push({ ...args, title: g.event.title, source_url: g.event.sourceUrl });
      details.push({ item_id: id, item_kind: 'event', fetched_at: args.fetched_at, venue: short(obj(e.venue).name, 60) || short(venue, 60),
        price_label: Array.isArray(e.ticket_info) && e.ticket_info.length ? 'tickets' : '',
        summary: short(e.description, 280), keywords: [topic, ...topic.split('-')] });
    }
  }
  return { upserts, rejected, details };
}
