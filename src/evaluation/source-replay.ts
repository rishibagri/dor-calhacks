// DS source replay (README D045 DS Phase 5 prep). Pure core plus a small CLI; no network, no provider, no database.
//
// Input is a saved catalogue dataset in one of two shapes:
// - a raw Actor dataset `{ <topic>: item[] }` (what CS's src/server/discovery/apify.ts returns), run through CS's real
//   `normalizeCatalogue` (same allowlist readers, injection/URL/region/window drops and `guardCatalogueEvent`);
// - the JSON printed by `node scripts/ingest-catalogue.ts --fetch` without `--commit` (`{provenance, events}`), whose
//   `events` are already-normalized `upsert_catalogue_event` args.
// Either way the rows then pass the `catalogue_events` view rule (`catalogueEventUsable`, status dropped) and DS's
// `eligibleEvents` per launch area. The report never prints titles, URLs, hosts or guests: event ids, topics,
// areas and reason codes only. A dataset is labeled SYNTHETIC unless it carries non-synthetic provenance.
//
//   node src/evaluation/source-replay.ts                         # the synthetic Berkeley fixture
//   node src/evaluation/source-replay.ts --dataset <file.json>   # e.g. a saved approved Actor run
//   ... [--now <ISO>] [--write]                                   # --write saves results/source-replay.md
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { catalogueEventUsable } from '@dor/contracts/policy';
import { loadDiscoveryConfig, type SourceKind } from '../server/discovery/config.ts';
import { normalizeCatalogue } from '../server/discovery/normalize.ts';
import type { UpsertArgs } from '../lib/catalogue/ingest.ts';
import { AREA_KEYS, DISCOVERY_TAGS } from '../lib/discovery/config.ts';
import { eligibleEvents, type CatalogueEventRow } from './events.ts';

export const DEFAULT_DATASET = fileURLToPath(new URL('./fixtures/berkeley-luma.synthetic.json', import.meta.url));

export interface Provenance { synthetic: boolean; source: string; fetchedAt: string | null; label: string }
export interface CatalogueReplay {
  provenance: Provenance;
  /** `catalogue_events` view rows (camelCase, ISO times), soonest first. */
  rows: CatalogueEventRow[];
  /** Normalizer drops (topic + reason) and view drops (event id + reason). Never titles or URLs. */
  normalizerRejected: { topic: string; reason: string }[];
  viewDropped: { eventId: string; reason: string }[];
  upserts: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function provenanceOf(data: Record<string, unknown>): Provenance {
  const p = isObj(data._provenance) ? data._provenance : isObj(data.provenance) ? data.provenance : null;
  const fetchedAt = p && typeof p.fetchedAt === 'string' && Number.isFinite(Date.parse(p.fetchedAt)) ? p.fetchedAt : null;
  // Only an explicit `synthetic: false` (or ingest provenance without the flag) counts as source-recorded.
  const synthetic = data._synthetic === true || !p || p.synthetic === true || fetchedAt === null;
  const source = p && typeof p.source === 'string' ? p.source : p && typeof p.sourceHost === 'string' ? p.sourceHost : 'unknown';
  return { synthetic, source, fetchedAt, label: synthetic ? 'SYNTHETIC (hand-written fixture; no Actor run)' : `source-recorded (${source}, fetched ${fetchedAt})` };
}

/** `upsert_catalogue_event` args → what the `catalogue_events` view would serve (module views.ts rule). */
export function viewRows(upserts: readonly UpsertArgs[]): { rows: CatalogueEventRow[]; dropped: CatalogueReplay['viewDropped'] } {
  const rows: CatalogueEventRow[] = [];
  const dropped: CatalogueReplay['viewDropped'] = [];
  for (const u of upserts) {
    const why = catalogueEventUsable({ eventId: u.event_id, startsAtMs: Date.parse(u.starts_at), endsAtMs: u.ends_at ? Date.parse(u.ends_at) : null,
      status: u.status, fetchedAtMs: Date.parse(u.fetched_at), topics: u.topics, staleMarked: false }, null);
    if (why) { dropped.push({ eventId: u.event_id, reason: why }); continue; }
    rows.push({ eventId: u.event_id, title: u.title, startsAt: u.starts_at, endsAt: u.ends_at, topics: [...u.topics], format: u.format,
      areaKey: u.area_key, sourceUrl: u.source_url, fetchedAt: u.fetched_at });
  }
  rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.eventId.localeCompare(b.eventId));
  return { rows, dropped };
}

/** Raw Actor dataset or ingest output → view rows. `nowMs` is the replay clock (normalizer window and start checks). */
export function replayCatalogue(data: unknown, nowMs: number): CatalogueReplay {
  if (!isObj(data)) throw new Error('dataset must be a JSON object');
  const provenance = provenanceOf(data);
  if (Array.isArray(data.events)) {
    const { rows, dropped } = viewRows(data.events as UpsertArgs[]);
    return { provenance, rows, normalizerRejected: [], viewDropped: dropped, upserts: data.events.length };
  }
  const raw: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(data)) if (!k.startsWith('_') && Array.isArray(v)) raw[k] = v;
  const source = (isObj(data._provenance) && data._provenance.source === 'meetup' ? 'meetup' : 'luma') as SourceKind;
  // Token and Actor are placeholders: normalization never fetches. Region, areas and caps are CS's fixed config.
  const cfg = loadDiscoveryConfig({ APIFY_API_TOKEN: 'offline-replay-no-token', APIFY_ACTOR_BUILD: 'offline-replay', APIFY_SOURCE: source,
    APIFY_ACTOR_ID: source === 'luma' ? 'tortuga/luma-scraper' : 'filip_cicvarek/meetup-scraper', APIFY_TOPICS: Object.keys(raw).join(','),
    APIFY_MAX_ITEMS: '50' });
  if (!cfg.ok) throw new Error(`dataset topics fail CS's discovery config: ${cfg.reason}`);
  const fetchedAtMs = provenance.fetchedAt ? Date.parse(provenance.fetchedAt) : nowMs;
  const report = normalizeCatalogue(raw, { config: cfg.config, allow: { tags: DISCOVERY_TAGS, areas: AREA_KEYS, hosts: [] }, fetchedAtMs, nowMs });
  const { rows, dropped } = viewRows(report.upserts);
  return { provenance, rows, normalizerRejected: report.rejected.map(r => ({ topic: r.topic, reason: r.reason })), viewDropped: dropped,
    upserts: report.upserts.length };
}

const count = (xs: readonly string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())]
  .sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';

/** Markdown report: ids, topics, areas and reason codes only. */
export function renderReplay(r: CatalogueReplay, now: Date, datasetName: string): string {
  const areas = [...new Set(AREA_KEYS)];
  const lines = [
    '# DS source replay (catalogue → eligible events)', '',
    `**Data:** ${r.provenance.label}. Dataset \`${datasetName}\`; replay clock ${now.toISOString()}.`,
    'Pipeline: CS `normalizeCatalogue` (or saved ingest output) → `catalogue_events` view rule → DS `eligibleEvents` per launch area.',
    'No titles, URLs, hosts or guests are printed. Regenerate with `node src/evaluation/source-replay.ts [--dataset <file>] --write`.', '',
    `- Normalized rows: ${r.upserts}; normalizer drops: ${count(r.normalizerRejected.map(x => x.reason))}`,
    `- Dropped by the view rule: ${count(r.viewDropped.map(x => x.reason))}`,
    `- Served by \`catalogue_events\`: ${r.rows.length}`, '',
    '| Area | Eligible events (id: topics) | Withheld (reason count) |', '|---|---|---|',
  ];
  for (const a of areas) {
    const e = eligibleEvents(r.rows, a, [...DISCOVERY_TAGS], now);
    const own = e.excluded.filter(x => x.reason !== 'wrong_area').map(x => x.reason);
    lines.push(`| ${a} | ${e.eligible.map(x => `\`${x.eventId.slice(0, 18)}…\`: ${x.topics.join('+')}`).join('<br>') || '—'} | ${count(own)} |`);
  }
  lines.push('', r.provenance.synthetic
    ? '**Synthetic:** this proves the pipeline shape only. Rerun with a saved approved Actor dataset before any usefulness claim.'
    : '**Source-recorded:** usefulness still needs personas against these rows (`node src/evaluation/transition.ts --dataset <file>`).', '');
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const val = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const dataset = val('--dataset') ?? DEFAULT_DATASET;
  const data = JSON.parse(await readFile(dataset, 'utf8'));
  const now = new Date(val('--now') ?? (dataset === DEFAULT_DATASET ? '2026-10-24T18:00:00Z' : new Date().toISOString()));
  const md = renderReplay(replayCatalogue(data, now.getTime()), now, dataset === DEFAULT_DATASET ? 'fixtures/berkeley-luma.synthetic.json' : dataset.split('/').at(-1)!);
  if (args.includes('--write')) await writeFile(new URL('./results/source-replay.md', import.meta.url), md);
  process.stdout.write(md);
}
