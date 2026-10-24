/**
 * CS-R3 catalogue ingestion runner (server/developer side only; never imported by the app).
 *
 *   node scripts/ingest-catalogue.ts --fixture <file.json>   # offline: normalize a saved dataset, print report
 *   node scripts/ingest-catalogue.ts --fetch                  # call Apify (costs credits), print report
 *   ... [--commit <database>] [--force]                       # also upsert via `spacetime call` as the ingester
 *
 * Env for --fetch: APIFY_API_TOKEN, APIFY_TASK_ID. The Apify *task* holds the developer-reviewed regional source
 * configuration (D028/D031: never device-derived); this script only overrides the generic, guarded query
 * (topic, limit, locale). The token goes in a header and is never printed.
 * --commit requires the CLI to be logged in as an identity registered with set_worker_identity (or the owner).
 * Single-flight: a lock file per feed; at most one fetch per REFRESH_WINDOW_MS unless --force.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PublicCatalogueQuery } from '@dor/contracts';
import { AREA_KEYS, DISCOVERY_TAGS } from '../src/lib/discovery/config.ts';
import { FEEDS, FIELD_MAP, REFRESH_WINDOW_MS, SOURCE_HOSTS, SOURCE_KEY } from '../src/lib/catalogue/feeds.ts';
import { feedQueries, ingest, shouldRefresh, type UpsertArgs } from '../src/lib/catalogue/ingest.ts';

const CACHE_DIR = join(process.cwd(), '.cache', 'catalogue');
const FETCH_TIMEOUT_MS = 120_000;
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const allow = { tags: DISCOVERY_TAGS, areas: AREA_KEYS, hosts: SOURCE_HOSTS };

async function runTask(query: PublicCatalogueQuery): Promise<unknown[]> {
  const token = process.env.APIFY_API_TOKEN, task = process.env.APIFY_TASK_ID;
  if (!token || !task) throw new Error('APIFY_API_TOKEN and APIFY_TASK_ID are required for --fetch');
  const res = await fetch(`https://api.apify.com/v2/actor-tasks/${encodeURIComponent(task)}/run-sync-get-dataset-items?clean=true&limit=${query.limit}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    // Only the guarded generic fields. The task's saved input supplies the reviewed regional source.
    body: JSON.stringify({ searchTerms: query.topics, maxItems: query.limit, ...(query.locale ? { language: query.locale } : {}) }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Apify task failed with HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error('Apify dataset was not an array');
  return body;
}

/** SATS JSON for `spacetime call`: options are {"some": v} / {"none": []}. */
const opt = (v: string | null) => (v === null ? { none: [] } : { some: v });
function commit(db: string, u: UpsertArgs): void {
  const positional = [u.event_id, u.title, u.starts_at, opt(u.ends_at), u.status, u.fetched_at, u.topics, u.format, opt(u.area_key), opt(u.source_url)];
  execFileSync('spacetime', ['call', db, 'upsert_catalogue_event', ...positional.map((p) => JSON.stringify(p))], { stdio: ['ignore', 'ignore', 'inherit'] });
}

/** Health row for the Events page: ok with the count, or failed (the module keeps the last success). */
function recordRun(db: string, feedKey: string, ok: boolean, count: number): void {
  execFileSync('spacetime', ['call', db, 'record_catalogue_run', JSON.stringify(feedKey), JSON.stringify(ok), JSON.stringify(count)],
    { stdio: ['ignore', 'ignore', 'inherit'] });
}

async function main(): Promise<void> {
  const fixture = value('--fixture');
  if (!fixture && !flag('--fetch')) throw new Error('pass --fixture <file> (offline) or --fetch (Apify)');
  mkdirSync(CACHE_DIR, { recursive: true });
  for (const feed of FEEDS) {
    const q = feedQueries(feed, allow);
    if (!q.ok) throw new Error(`feed ${feed.areaKey} refused by the D028 query guard: ${q.reason}`);
    const cacheFile = join(CACHE_DIR, `${feed.areaKey}.json`), lock = `${cacheFile}.lock`;
    const last = existsSync(cacheFile) ? (JSON.parse(readFileSync(cacheFile, 'utf8')) as { fetchedAtMs: number }).fetchedAtMs : null;
    if (!fixture && !flag('--force') && !shouldRefresh(last, Date.now(), REFRESH_WINDOW_MS)) {
      console.log(JSON.stringify({ feed: feed.areaKey, skipped: 'within_refresh_window', lastFetchedAt: new Date(last!).toISOString() }));
      continue;
    }
    if (existsSync(lock)) throw new Error(`another ingestion holds ${lock}`);
    writeFileSync(lock, String(process.pid), { flag: 'wx' });
    try {
      const fetchedAtMs = Date.now();
      const datasets: Record<string, unknown[]> = {};
      if (fixture) {
        const raw = JSON.parse(readFileSync(fixture, 'utf8')) as Record<string, unknown[]>;
        for (const t of feed.topics) datasets[t] = Array.isArray(raw[t]) ? raw[t]! : [];
      } else {
        for (const query of q.queries) datasets[query.topics[0]!] = await runTask(query); // sequential: bounded cost
      }
      const report = ingest(datasets, { sourceKey: SOURCE_KEY, feed, map: FIELD_MAP, allow, fetchedAtMs, nowMs: Date.now() });
      const db = value('--commit');
      if (db) report.upserts.forEach((u) => commit(db, u));
      if (db) recordRun(db, feed.areaKey, true, report.upserts.length);
      if (!fixture) writeFileSync(cacheFile, JSON.stringify({ fetchedAtMs, count: report.upserts.length }));
      console.log(JSON.stringify({ feed: feed.areaKey, fetchedAt: new Date(fetchedAtMs).toISOString(), committed: Boolean(db),
        upserts: report.upserts.length, rejected: report.rejected, events: db ? undefined : report.upserts }, null, 2));
    } catch (e) {
      const db = value('--commit');
      if (db) { try { recordRun(db, feed.areaKey, false, 0); } catch { /* the original failure is the one to report */ } }
      throw e;
    } finally {
      rmSync(lock, { force: true });
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'ingestion failed');
  process.exit(1);
});
