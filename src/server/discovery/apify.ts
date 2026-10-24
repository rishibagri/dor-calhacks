/**
 * Server-only Apify fetch (D045). The signature takes NO user data: the request body is derived solely from the
 * fixed config and passed through `guardPublicCatalogueQuery` (D028). Never call per render; go through cache.ts.
 * Token goes in a header only and is never logged or included in errors.
 */
import { guardPublicCatalogueQuery } from '@dor/contracts';
import type { DiscoveryConfig, SourceKind } from './config.ts';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>;
}>;

export class ApifyError extends Error {
  readonly code: 'guard_refused' | 'http' | 'timeout' | 'network' | 'bad_body';
  constructor(code: 'guard_refused' | 'http' | 'timeout' | 'network' | 'bad_body', message: string) { super(message); this.code = code; }
}

/** Raw Apify datasets keyed by the allowlisted topic whose query returned them. */
export type RawCatalogue = Record<string, unknown[]>;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Actor input built ONLY from the fixed config + the guarded generic query. Exact keys are asserted in tests. */
export function actorInput(source: SourceKind, config: DiscoveryConfig, topic: string, limit: number, nowMs: number): Record<string, unknown> {
  const keyword = topic.replace(/-/g, ' ');
  if (source === 'luma') {
    // tortuga/luma-scraper: `cities` slug, free-text `searchQuery`, `maxItems` = total cap.
    return { cities: [config.region.lumaCity], searchQuery: keyword, maxItems: limit, includeDetails: false, includePastEvents: false };
  }
  // filip_cicvarek/meetup-scraper: geocoded city, miles radius, `maxResults` = cap.
  return {
    mode: 'events', searchKeyword: keyword, city: config.region.city, state: config.region.state, country: config.region.country,
    radius: config.region.radiusMiles, eventType: 'PHYSICAL', sortBy: 'DATETIME', maxResults: limit,
    startDateRange: new Date(nowMs).toISOString(), endDateRange: new Date(nowMs + config.windowDays * 86_400_000).toISOString(),
  };
}

export function endpoint(config: DiscoveryConfig, limit: number): string {
  const q = new URLSearchParams({ clean: 'true', limit: String(limit), timeout: String(Math.ceil(config.timeoutMs / 1000)) });
  if (config.build) q.set('build', config.build);
  return `https://api.apify.com/v2/acts/${config.actorId}/run-sync-get-dataset-items?${q}`;
}

async function once(config: DiscoveryConfig, token: string, body: unknown, limit: number, fetchImpl: FetchLike): Promise<unknown[]> {
  let res;
  try {
    res = await fetchImpl(endpoint(config, limit), {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') throw new ApifyError('timeout', 'Apify request timed out');
    throw new ApifyError('network', 'Apify request failed');
  }
  if (!res.ok) throw new ApifyError('http', `Apify returned HTTP ${res.status}`);
  let json: unknown;
  try { json = await res.json(); } catch { throw new ApifyError('bad_body', 'Apify body was not JSON'); }
  if (!Array.isArray(json)) throw new ApifyError('bad_body', 'Apify dataset was not an array');
  return json.slice(0, limit); // the cap holds even if the Actor over-delivers
}

const retriable = (e: unknown) => e instanceof ApifyError && (e.code === 'network' || (e.code === 'http' && /HTTP (429|5\d\d)$/.test(e.message)));

export async function fetchCatalogue(
  config: DiscoveryConfig, token: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, nowMs: number = Date.now(),
): Promise<RawCatalogue> {
  const perTopic = Math.max(1, Math.floor(config.maxItems / config.topics.length));
  const out: RawCatalogue = {};
  for (const topic of config.topics) { // sequential: bounded cost
    const g = guardPublicCatalogueQuery({ format: 'in_person', topics: [topic], limit: perTopic, locale: 'en-US' }, config.topics);
    if (!g.ok) throw new ApifyError('guard_refused', `query refused by the D028 guard: ${g.reason}`);
    const body = actorInput(config.source, config, g.query.topics[0]!, g.query.limit, nowMs);
    let attempt = 0;
    for (;;) {
      try { out[topic] = await once(config, token, body, g.query.limit, fetchImpl); break; }
      catch (e) { if (attempt++ >= config.maxRetries || !retriable(e)) throw e; }
    }
  }
  return out;
}
