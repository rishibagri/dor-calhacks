/**
 * CS-R3 catalogue ingestion runner (server/developer side only; never imported by the app).
 *
 *   node scripts/ingest-catalogue.ts --fixture <file.json>   # offline: normalize a saved dataset, print report
 *   node scripts/ingest-catalogue.ts --fetch                  # call Apify (costs credits), print report
 *   ... [--commit <database> [--server local|maincloud|<url>]] [--force]   # also upsert via `spacetime call` as the ingester
 *
 * --server defaults to `local`, like bootstrap-module.ts and mint-worker-identity.ts. It is always passed as `-s`, so a
 * commit never falls through to the CLI's default server (often maincloud) by accident; name maincloud explicitly.
 *
 * Env for --fetch: APIFY_API_TOKEN, APIFY_ACTOR_ID, APIFY_ACTOR_BUILD (required pinned build), APIFY_SOURCE=luma|meetup,
 * APIFY_MAX_ITEMS<=50, APIFY_TOPICS, APIFY_WINDOW_DAYS, APIFY_TIMEOUT_MS). Region, caps and the request body come from
 * src/server/discovery/config.ts (fixed, never device-derived; guarded by D028). The token goes in a header only.
 * Without --fetch or --fixture the script is a dry run and makes no network call. See docs/features/APIFY_SOURCE.md.
 * --commit requires the CLI to be logged in as an identity registered with set_worker_identity (or the owner).
 * Single-flight: a lock file per feed; at most one fetch per REFRESH_WINDOW_MS unless --force.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalogue, loadDiscoveryConfig } from '../src/server/discovery/index.ts';
import { AREA_KEYS, DISCOVERY_TAGS } from '../src/lib/discovery/config.ts';
import { FEEDS, FIELD_MAP, REFRESH_WINDOW_MS, SOURCE_HOSTS, SOURCE_KEY } from '../src/lib/catalogue/feeds.ts';
import { feedQueries, ingest, shouldRefresh, type UpsertArgs } from '../src/lib/catalogue/ingest.ts';

const CACHE_DIR = join(process.cwd(), '.cache', 'catalogue');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const allow = { tags: DISCOVERY_TAGS, areas: AREA_KEYS, hosts: SOURCE_HOSTS };
const SERVER = value('--server') ?? 'local';

/** --fetch: server-only adapter (src/server/discovery): fixed config, capped, cached 6 h, one in-flight request. */
async function fetchViaAdapter(): Promise<void> {
  const db = value('--commit');
  const lockFile = join(CACHE_DIR, 'apify.lock'), stampFile = join(CACHE_DIR, 'apify.json');
  const last = existsSync(stampFile) ? (JSON.parse(readFileSync(stampFile, 'utf8')) as { fetchedAtMs: number }).fetchedAtMs : null;
  if (!flag('--force') && !shouldRefresh(last, Date.now(), REFRESH_WINDOW_MS)) {
    console.log(JSON.stringify({ skipped: 'within_refresh_window', lastFetchedAt: new Date(last!).toISOString() }));
    return;
  }
  if (existsSync(lockFile)) throw new Error(`another ingestion holds ${lockFile}`);
  writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
  try {
    const r = await loadCatalogue(process.env);
    if (db) r.upserts.forEach((u) => commit(db, u));
    for (const areaKey of r.config.areaKeys) if (db) recordRun(db, areaKey, true, r.upserts.filter((u) => u.area_key === areaKey).length);
    writeFileSync(stampFile, JSON.stringify({ fetchedAtMs: Date.parse(r.provenance.fetchedAt), count: r.upserts.length }));
    console.log(JSON.stringify({ provenance: r.provenance, committed: Boolean(db), upserts: r.upserts.length, rejected: r.rejected,
      events: db ? undefined : r.upserts }, null, 2));
  } catch (e) {
    const c = loadDiscoveryConfig(process.env);
    if (db) for (const a of c.ok ? c.config.areaKeys : []) { try { recordRun(db, a, false, 0); } catch { /* report the original failure */ } }
    throw e;
  } finally {
    rmSync(lockFile, { force: true });
  }
}

/** SATS JSON for `spacetime call`: options are {"some": v} / {"none": []}. */
const opt = (v: string | null) => (v === null ? { none: [] } : { some: v });
function commit(db: string, u: UpsertArgs): void {
  const positional = [u.event_id, u.title, u.starts_at, opt(u.ends_at), u.status, u.fetched_at, u.topics, u.format, opt(u.area_key), opt(u.source_url)];
  execFileSync('spacetime', ['call', '-s', SERVER, db, 'upsert_catalogue_event', ...positional.map((p) => JSON.stringify(p))], { stdio: ['ignore', 'ignore', 'inherit'] });
}

/** Health row for the Events page: ok with the count, or failed (the module keeps the last success). */
function recordRun(db: string, feedKey: string, ok: boolean, count: number): void {
  execFileSync('spacetime', ['call', '-s', SERVER, db, 'record_catalogue_run', JSON.stringify(feedKey), JSON.stringify(ok), JSON.stringify(count)],
    { stdio: ['ignore', 'ignore', 'inherit'] });
}

async function main(): Promise<void> {
  const fixture = value('--fixture');
  if (!fixture && !flag('--fetch')) { // dry run: validate configuration only, no network, no spend
    const c = loadDiscoveryConfig(process.env);
    console.log(JSON.stringify({ dryRun: true, hint: 'pass --fixture <file> (offline) or --fetch (calls Apify, costs credits)',
      config: c.ok ? { ...c.config, token: 'set' } : { notConfigured: c.reason } }, null, 2));
    return;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  if (!fixture) return fetchViaAdapter();
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
      {
        const raw = JSON.parse(readFileSync(fixture, 'utf8')) as Record<string, unknown[]>;
        for (const t of feed.topics) datasets[t] = Array.isArray(raw[t]) ? raw[t]! : [];
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
