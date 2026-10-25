/**
 * D057 live catalogue refresh. Server-only (never import from client code). Runs the pinned Apify Actors in parallel
 * over fixed, developer-configured queries (every place kind × launch area, every interest tag × city, plus the
 * configured Luma feed), normalizes with the existing default-deny code, and writes the results through the guarded
 * ingester reducers as the allow-listed worker identity. Nothing user-derived reaches Apify. Single-flight per process.
 */
import { DbConnection } from '@/lib/spacetime/module_bindings';
import { AREA_KEYS, DISCOVERY_TAGS } from '@/lib/discovery/config';
import { SOURCE_HOSTS } from '@/lib/catalogue/feeds';
import type { UpsertArgs } from '@/lib/catalogue/ingest';
import { CatalogueCache, loadCatalogue } from '@/server/discovery';
import {
  EVENT_CITIES, GOOGLE_EVENTS, GOOGLE_MAPS, googleEventsInput, normalizeGoogleEvents, normalizePlaces, placesInput, runActor,
  type DetailArgs, type PlaceArgs,
} from '@/server/discovery/google';
import { PLACE_KINDS } from '@dor/contracts/policy';
import { begin } from '@/server/activity';

export interface RefreshState {
  id: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  phase: 'scraping' | 'saving' | 'finished';
  runsTotal: number;
  runsDone: number;
  runsFailed: number;
  found: { events: number; places: number; details: number };
  saved: { events: number; places: number; details: number };
  rejected: number;
  /** Error codes only; never tokens, URLs or source text. */
  errors: string[];
}

const PLACES_PER_SEARCH = 20;
const EVENT_WINDOW_DAYS = 21;
const CONCURRENCY = 10;
const COOLDOWN_MS = 60_000;
let current: RefreshState | null = null;

export const refreshState = (): RefreshState | null => current && structuredClone(current);

type Batch = { events: UpsertArgs[]; places: PlaceArgs[]; details: DetailArgs[]; rejected: number };

async function pool<T>(tasks: (() => Promise<T>)[], n: number, onDone: (ok: boolean) => void): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++]!;
      try { out.push(await task()); onDone(true); } catch { onDone(false); }
    }
  }));
  return out;
}

function scrapeTasks(env: Record<string, string | undefined>, token: string): (() => Promise<Batch>)[] {
  const now = Date.now();
  const tasks: (() => Promise<Batch>)[] = [];
  for (const kind of PLACE_KINDS) for (const area of AREA_KEYS) {
    tasks.push(async () => {
      const r = normalizePlaces(await runActor(GOOGLE_MAPS, placesInput(kind, area, PLACES_PER_SEARCH), token), kind,
        { areaKeys: AREA_KEYS, fetchedAtMs: Date.now(), nowMs: Date.now() });
      return { events: [], places: r.upserts, details: r.details, rejected: r.rejected.length };
    });
  }
  for (const topic of DISCOVERY_TAGS) for (const city of EVENT_CITIES) {
    tasks.push(async () => {
      const r = normalizeGoogleEvents(await runActor(GOOGLE_EVENTS, googleEventsInput(topic, city), token), topic,
        { tags: DISCOVERY_TAGS, areaKeys: AREA_KEYS, hosts: SOURCE_HOSTS, fetchedAtMs: Date.now(), nowMs: Date.now(), windowDays: EVENT_WINDOW_DAYS });
      return { events: r.upserts, places: [], details: r.details, rejected: r.rejected.length };
    });
  }
  // The configured Luma feed (APIFY_ACTOR_ID/BUILD), always fresh: a new cache skips the 6 h one.
  if (env.APIFY_ACTOR_ID && env.APIFY_ACTOR_BUILD) {
    tasks.push(async () => {
      const r = await loadCatalogue(env, { cache: new CatalogueCache(), nowMs: () => now });
      return { events: r.upserts, places: [], details: [], rejected: r.rejected.length };
    });
  }
  return tasks;
}

const camelKeys = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()), v ?? undefined]));

async function openIngester(env: Record<string, string | undefined>): Promise<DbConnection> {
  const uri = env.DOR_SPACETIME_URI || env.NEXT_PUBLIC_SPACETIMEDB_URI;
  const db = env.DOR_SPACETIME_MODULE || env.NEXT_PUBLIC_SPACETIMEDB_MODULE;
  const token = env.DOR_SPACETIME_WORKER_TOKEN;
  if (!uri || !db || !token) throw new Error('ingester_not_configured');
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ingester_connect_timeout')), 15_000);
    DbConnection.builder().withUri(uri).withDatabaseName(db).withToken(token)
      .onConnect((c) => { clearTimeout(t); resolve(c); })
      .onConnectError(() => { clearTimeout(t); reject(new Error('ingester_connect_failed')); })
      .build();
  });
}

async function save(conn: DbConnection, reducer: string, rows: Record<string, unknown>[], state: RefreshState): Promise<number> {
  const call = (conn.reducers as unknown as Record<string, (a: unknown) => Promise<unknown>>)[reducer]!;
  let ok = 0;
  for (let i = 0; i < rows.length; i += 25) {
    const results = await Promise.allSettled(rows.slice(i, i + 25).map((r) => call(camelKeys(r))));
    for (const r of results) {
      if (r.status === 'fulfilled') ok++;
      else {
        state.rejected++;
        const code = String((r.reason as Error)?.message ?? 'error').split(':')[0]!.slice(0, 40);
        if (state.errors.length < 20 && !state.errors.includes(`${reducer}:${code}`)) state.errors.push(`${reducer}:${code}`);
      }
    }
  }
  return ok;
}

/** Starts a refresh unless one is running or finished within the last minute; returns the current state. */
export function startRefresh(env: Record<string, string | undefined>, userId: string | null = null): RefreshState {
  if (current?.status === 'running') return structuredClone(current);
  if (current?.finishedAt && Date.now() - Date.parse(current.finishedAt) < COOLDOWN_MS) return structuredClone(current);
  const token = env.APIFY_API_TOKEN?.trim();
  const state: RefreshState = {
    id: crypto.randomUUID(), status: 'running', startedAt: new Date().toISOString(), finishedAt: null, phase: 'scraping',
    runsTotal: 0, runsDone: 0, runsFailed: 0, found: { events: 0, places: 0, details: 0 }, saved: { events: 0, places: 0, details: 0 },
    rejected: 0, errors: [],
  };
  current = state;
  const end = begin('apify', 'live catalogue refresh', userId);
  void (async () => {
    try {
      if (!token) throw new Error('apify_not_configured');
      const tasks = scrapeTasks(env, token);
      state.runsTotal = tasks.length;
      const batches = await pool(tasks, CONCURRENCY, (ok) => { state.runsDone++; if (!ok) state.runsFailed++; });
      const dedupe = <T>(rows: T[], key: (r: T) => string) => [...new Map(rows.map((r) => [key(r), r])).values()];
      const events = dedupe(batches.flatMap((b) => b.events), (e) => e.event_id);
      const places = dedupe(batches.flatMap((b) => b.places), (p) => p.place_id);
      const details = dedupe(batches.flatMap((b) => b.details), (d) => d.item_id);
      state.rejected += batches.reduce((n, b) => n + b.rejected, 0);
      state.found = { events: events.length, places: places.length, details: details.length };
      state.phase = 'saving';
      const conn = await openIngester(env);
      try {
        state.saved.events = await save(conn, 'upsertCatalogueEvent', events as unknown as Record<string, unknown>[], state);
        state.saved.places = await save(conn, 'upsertCataloguePlace', places as unknown as Record<string, unknown>[], state);
        state.saved.details = await save(conn, 'upsertCatalogueDetail', details as unknown as Record<string, unknown>[], state);
        const perArea = (k: string) => events.filter((e) => e.area_key === k).length + places.filter((p) => p.area_key === k).length;
        await save(conn, 'recordCatalogueRun', AREA_KEYS.map((k) => ({ feed_key: k, ok: true, record_count: perArea(k) })), state);
      } finally { conn.disconnect(); }
      state.status = 'done';
    } catch (e) {
      state.status = 'failed';
      state.errors.push(String((e as Error)?.message ?? 'failed').slice(0, 60));
    } finally {
      state.phase = 'finished';
      state.finishedAt = new Date().toISOString();
      end(state.status === 'done' ? 'ok' : 'error');
    }
  })();
  return structuredClone(state);
}
