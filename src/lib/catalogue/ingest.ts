/**
 * CS-R3 public catalogue ingestion (C7, D028/D039). Pure: no network, no clock reads.
 *
 * One developer-configured regional feed per area. Every Apify request is built only through
 * `guardPublicCatalogueQuery` (generic allowlisted topic, format, limit); no user, device location, pair or
 * account data can reach it. Each record is normalized and passed through the SAME `guardCatalogueEvent` the
 * module runs in `upsert_catalogue_event`, so anything the server would refuse is dropped here first.
 *
 * Topics are never inferred from scraped text: a record carries the allowlisted topic(s) of the query that
 * returned it. Titles are inert display text; instruction-like titles are kept out of the catalogue entirely.
 */
import { createHash } from 'node:crypto';
import { CATALOGUE_MAX_HORIZON_MS, guardCatalogueEvent } from '@dor/contracts/policy';
import { guardPublicCatalogueQuery, type PublicCatalogueQuery } from '@dor/contracts';
import { looksLikeInstruction } from './ingest-text.ts';

export { looksLikeInstruction };

export interface CatalogueFeed {
  /** Configured area key the whole feed belongs to (never derived from a device). */
  areaKey: string;
  /** Allowlisted topics queried one at a time so each record's topic is the query's, not a guess. */
  topics: string[];
  format: 'in_person' | 'online';
  limitPerTopic: number;
  locale?: string;
}

export interface SourceFieldMap {
  title: string;
  startsAt: string;
  endsAt?: string;
  url?: string;
  cancelled?: string;
}

/** Arguments for `upsert_catalogue_event`, exactly as the reducer takes them. */
export interface UpsertArgs {
  event_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  status: 'scheduled' | 'cancelled' | 'unknown';
  fetched_at: string;
  topics: string[];
  format: 'in_person' | 'online';
  area_key: string | null;
  source_url: string | null;
}

export interface Allowlists { tags: readonly string[]; areas: readonly string[]; hosts: readonly string[] }

export type Rejection = { index: number; reason: string };

/** Per-topic Apify inputs for one feed; refuses the whole feed if any query fails the D028 guard. */
export function feedQueries(feed: CatalogueFeed, allow: Allowlists): { ok: true; queries: PublicCatalogueQuery[] } | { ok: false; reason: string } {
  if (!allow.areas.includes(feed.areaKey)) return { ok: false, reason: 'area_not_allowlisted' };
  const queries: PublicCatalogueQuery[] = [];
  for (const topic of feed.topics) {
    const g = guardPublicCatalogueQuery({
      format: feed.format, topics: [topic], limit: feed.limitPerTopic, ...(feed.locale ? { locale: feed.locale } : {}),
    }, allow.tags);
    if (!g.ok) return { ok: false, reason: g.reason };
    queries.push(g.query);
  }
  return { ok: true, queries };
}

function field(item: unknown, path: string | undefined): unknown {
  if (!path || typeof item !== 'object' || item === null) return undefined;
  return path.split('.').reduce<unknown>((v, k) => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[k] : undefined), item);
}

const isoMs = (v: unknown): number | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const ms = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};

/** Stable, opaque, source-scoped ID: same listing on a later fetch keeps the same ID (plans stay bound). */
export function stableEventId(sourceKey: string, url: string | null, title: string, startsAtMs: number): string {
  const basis = url ?? `${title.toLowerCase().replace(/\s+/g, ' ').trim()}|${startsAtMs}`;
  return `${sourceKey}:${createHash('sha256').update(basis).digest('hex').slice(0, 32)}`;
}

/** One dataset item → upsert args, or why it was dropped. `fetchedAtMs` is the run time, never a source claim. */
export function normalizeItem(item: unknown, ctx: {
  sourceKey: string; topic: string; feed: CatalogueFeed; map: SourceFieldMap; allow: Allowlists; fetchedAtMs: number; nowMs: number;
}): { ok: true; args: UpsertArgs } | { ok: false; reason: string } {
  const title = field(item, ctx.map.title);
  const startsAtMs = isoMs(field(item, ctx.map.startsAt));
  if (typeof title !== 'string' || startsAtMs === null) return { ok: false, reason: 'missing_fields' };
  if (looksLikeInstruction(title)) return { ok: false, reason: 'instruction_like_title' };
  const endRaw = field(item, ctx.map.endsAt);
  const endsAtMs = endRaw === undefined || endRaw === null || endRaw === '' ? null : isoMs(endRaw);
  if (endRaw && endsAtMs === null) return { ok: false, reason: 'bad_end_time' };
  const urlRaw = field(item, ctx.map.url);
  const sourceUrl = typeof urlRaw === 'string' && urlRaw.length > 0 ? urlRaw : null;
  const cancelled = field(item, ctx.map.cancelled) === true;
  const g = guardCatalogueEvent({
    eventId: stableEventId(ctx.sourceKey, sourceUrl, title, startsAtMs), title, startsAtMs, endsAtMs,
    status: cancelled ? 'cancelled' : 'scheduled', fetchedAtMs: ctx.fetchedAtMs, topics: [ctx.topic], format: ctx.feed.format,
    areaKey: ctx.feed.format === 'in_person' ? ctx.feed.areaKey : null, sourceUrl,
  }, ctx.allow, ctx.nowMs);
  if (!g.ok) return { ok: false, reason: g.reason };
  if (g.event.startsAtMs <= ctx.nowMs) return { ok: false, reason: 'already_started' };
  const e = g.event;
  return { ok: true, args: {
    event_id: e.eventId, title: e.title, starts_at: new Date(e.startsAtMs).toISOString(),
    ends_at: e.endsAtMs === null ? null : new Date(e.endsAtMs).toISOString(), status: e.status,
    fetched_at: new Date(e.fetchedAtMs).toISOString(), topics: e.topics, format: e.format, area_key: e.areaKey, source_url: e.sourceUrl,
  } };
}

/**
 * Dedupe by event ID: topics merge (bounded by the guard's topic cap), a cancellation wins over scheduled, and the
 * earliest start is kept for conflicting copies. Order-independent.
 */
export function dedupe(rows: readonly UpsertArgs[], maxTopics = 5): UpsertArgs[] {
  const byId = new Map<string, UpsertArgs>();
  for (const r of rows) {
    const cur = byId.get(r.event_id);
    if (!cur) { byId.set(r.event_id, { ...r, topics: [...r.topics] }); continue; }
    const topics = [...new Set([...cur.topics, ...r.topics])].sort().slice(0, maxTopics);
    const status = cur.status === 'cancelled' || r.status === 'cancelled' ? 'cancelled' : cur.status;
    const first = Date.parse(r.starts_at) < Date.parse(cur.starts_at) ? r : cur;
    byId.set(r.event_id, { ...first, topics, status });
  }
  return [...byId.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.event_id.localeCompare(b.event_id));
}

export interface IngestReport { upserts: UpsertArgs[]; rejected: (Rejection & { topic: string })[] }

/** Normalizes every topic's dataset for one run. `datasets[topic]` is the raw Apify dataset for that topic. */
export function ingest(datasets: Record<string, readonly unknown[]>, ctx: {
  sourceKey: string; feed: CatalogueFeed; map: SourceFieldMap; allow: Allowlists; fetchedAtMs: number; nowMs: number;
}): IngestReport {
  const out: UpsertArgs[] = [];
  const rejected: IngestReport['rejected'] = [];
  for (const topic of ctx.feed.topics) {
    (datasets[topic] ?? []).forEach((item, index) => {
      const r = normalizeItem(item, { ...ctx, topic });
      if (r.ok) out.push(r.args); else rejected.push({ topic, index, reason: r.reason });
    });
  }
  return { upserts: dedupe(out).filter((u) => Date.parse(u.starts_at) <= ctx.nowMs + CATALOGUE_MAX_HORIZON_MS), rejected };
}

/** Refresh window: at most one fetch per feed per window (R4 single-flight budget). */
export function shouldRefresh(lastFetchedAtMs: number | null, nowMs: number, windowMs: number): boolean {
  return lastFetchedAtMs === null || nowMs - lastFetchedAtMs >= windowMs;
}
