/**
 * Raw Actor items -> `upsert_catalogue_event` args (D045). Pure; no network or clock reads.
 *
 * Only an explicit allowlist of public event fields is read. Attendee, guest, RSVP, host/organizer and description
 * fields are never read, so they cannot reach the output. Titles are untrusted text: instruction-like ones are
 * dropped and the shared guard strips markup/control characters. Topics come from the query, never from text.
 * Region/area is decided from the VENUE's public coordinates against configured launch areas, not from any user.
 */
import { createHash } from 'node:crypto';
import { guardCatalogueEvent } from '@dor/contracts/policy';
import { LAUNCH_AREAS } from '../../lib/discovery/config.ts';
import { dedupe, looksLikeInstruction, type UpsertArgs } from '../../lib/catalogue/ingest.ts';
import type { DiscoveryConfig, SourceKind } from './config.ts';
import type { RawCatalogue } from './apify.ts';

export interface Allow { tags: readonly string[]; areas: readonly string[]; hosts: readonly string[] }
/** Source link hosts. Provenance is the host of the stored URL. */
export const SOURCE_HOST_FOR: Record<SourceKind, readonly string[]> = { luma: ['lu.ma', 'luma.com'], meetup: ['meetup.com'] };

interface Common {
  sourceId: string | null; title: unknown; startsAt: unknown; endsAt: unknown; timezone: unknown;
  url: unknown; lat: unknown; lon: unknown; cancelled: boolean;
}

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});

/** Allowlisted public fields per Actor; everything else is ignored. */
const READERS: Record<SourceKind, (item: Record<string, unknown>) => Common | null> = {
  // tortuga/luma-scraper: id `evt-...`, name, startAt/endAt (UTC ISO), timezone, venue{latitude,longitude}, url
  luma: (i) => ({ sourceId: typeof i.id === 'string' ? i.id : null, title: i.name, startsAt: i.startAt, endsAt: i.endAt, timezone: i.timezone,
    url: i.url, lat: obj(i.venue).latitude, lon: obj(i.venue).longitude, cancelled: false }),
  // filip_cicvarek/meetup-scraper: eventId, eventName, startDateTime/endDateTime (+ IANA timezone), venue{lat,lon}, eventUrl
  meetup: (i) => ({ sourceId: typeof i.eventId === 'string' || typeof i.eventId === 'number' ? String(i.eventId) : null, title: i.eventName,
    startsAt: i.startDateTime, endsAt: i.endDateTime, timezone: i.timezone, url: i.eventUrl,
    lat: obj(i.venue).lat, lon: obj(i.venue).lon, cancelled: i.status === 'CANCELLED' }),
};

/** ISO instant (any offset, or `Z`) -> UTC ms. A string with no offset is read as local time in `tz` (IANA). */
export function toUtcMs(v: unknown, tz: unknown): number | null {
  if (typeof v !== 'string') return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(v)) { const ms = Date.parse(v); return Number.isFinite(ms) ? ms : null; }
  if (typeof tz !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/.test(tz)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(v);
  if (!m) return null;
  const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  try {
    const part = (ms: number) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(ms).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
    };
    return guess - (part(guess) - guess);
  } catch { return null; }
}

export function areaForVenue(lat: unknown, lon: unknown, areaKeys: readonly string[]): string | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const a = LAUNCH_AREAS.find((x) => areaKeys.includes(x.key) && lat >= x.bounds.south && lat <= x.bounds.north && lon >= x.bounds.west && lon <= x.bounds.east);
  return a?.key ?? null;
}

/** Stable source id first (`apify:<hash(source|id)>`); otherwise a hash of url+start. */
export function eventIdFor(source: SourceKind, sourceId: string | null, url: string | null, startsAtMs: number): string {
  const basis = sourceId ? `${source}|id|${sourceId}` : `${source}|${url ?? ''}|${startsAtMs}`;
  return `apify:${createHash('sha256').update(basis).digest('hex').slice(0, 32)}`;
}

export interface NormalizeCtx { config: DiscoveryConfig; allow: Allow; fetchedAtMs: number; nowMs: number }
export type NormalizeReport = { upserts: UpsertArgs[]; rejected: { topic: string; index: number; reason: string }[] };

export function normalizeCatalogue(raw: RawCatalogue, ctx: NormalizeCtx): NormalizeReport {
  const read = READERS[ctx.config.source];
  const hosts = SOURCE_HOST_FOR[ctx.config.source];
  const rows: UpsertArgs[] = [];
  const rejected: NormalizeReport['rejected'] = [];
  for (const topic of ctx.config.topics) {
    (raw[topic] ?? []).slice(0, ctx.config.maxItems).forEach((item, index) => {
      const drop = (reason: string) => { rejected.push({ topic, index, reason }); };
      if (typeof item !== 'object' || item === null) return drop('not_object');
      const c = read(item as Record<string, unknown>);
      if (!c || typeof c.title !== 'string') return drop('missing_fields');
      if (looksLikeInstruction(c.title)) return drop('instruction_like_title');
      const startsAtMs = toUtcMs(c.startsAt, c.timezone);
      if (startsAtMs === null) return drop('bad_start_time');
      const endsAtMs = c.endsAt == null || c.endsAt === '' ? null : toUtcMs(c.endsAt, c.timezone);
      if (c.endsAt != null && c.endsAt !== '' && endsAtMs === null) return drop('bad_end_time');
      if (startsAtMs <= ctx.nowMs) return drop('already_started');
      if (startsAtMs > ctx.nowMs + ctx.config.windowDays * 86_400_000) return drop('outside_window');
      const areaKey = areaForVenue(c.lat, c.lon, ctx.config.areaKeys);
      if (!areaKey) return drop('outside_region');
      const url = typeof c.url === 'string' ? c.url : null;
      const g = guardCatalogueEvent({
        eventId: eventIdFor(ctx.config.source, c.sourceId, url, startsAtMs), title: c.title, startsAtMs, endsAtMs,
        status: c.cancelled ? 'cancelled' : 'scheduled', fetchedAtMs: ctx.fetchedAtMs, topics: [topic], format: 'in_person', areaKey, sourceUrl: url,
      }, { ...ctx.allow, hosts }, ctx.nowMs);
      if (!g.ok) return drop(g.reason);
      const e = g.event;
      rows.push({ event_id: e.eventId, title: e.title, starts_at: new Date(e.startsAtMs).toISOString(),
        ends_at: e.endsAtMs === null ? null : new Date(e.endsAtMs).toISOString(), status: e.status,
        fetched_at: new Date(e.fetchedAtMs).toISOString(), topics: e.topics, format: 'in_person', area_key: e.areaKey, source_url: e.sourceUrl });
    });
  }
  return { upserts: dedupe(rows), rejected };
}

/** Provenance stamp for logs/run records: where the rows came from and when. Hosts only, never URLs with queries. */
export function provenance(config: DiscoveryConfig, fetchedAtMs: number): { sourceHost: string; source: SourceKind; actor: string; fetchedAt: string } {
  return { sourceHost: SOURCE_HOST_FOR[config.source][0]!, source: config.source, actor: config.actorId, fetchedAt: new Date(fetchedAtMs).toISOString() };
}
