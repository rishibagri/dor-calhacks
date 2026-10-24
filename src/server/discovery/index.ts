/** Server-only entry: cached, single-flight, capped Apify catalogue load + normalization. */
import { DISCOVERY_TAGS, AREA_KEYS } from '../../lib/discovery/config.ts';
import { fetchCatalogue, type FetchLike } from './apify.ts';
import { CatalogueCache } from './cache.ts';
import { loadDiscoveryConfig, type DiscoveryConfig } from './config.ts';
import { normalizeCatalogue, provenance, SOURCE_HOST_FOR, type NormalizeReport } from './normalize.ts';
import type { RawCatalogue } from './apify.ts';

export * from './config.ts';
export * from './apify.ts';
export * from './normalize.ts';
export * from './cache.ts';

export const sharedCache = new CatalogueCache<{ raw: RawCatalogue; fetchedAtMs: number }>();

export interface CatalogueLoad extends NormalizeReport { config: DiscoveryConfig; provenance: ReturnType<typeof provenance>; fromCache: boolean }

export async function loadCatalogue(env: Record<string, string | undefined>, deps: {
  fetchImpl?: FetchLike; cache?: CatalogueCache<{ raw: RawCatalogue; fetchedAtMs: number }>; nowMs?: () => number;
} = {}): Promise<CatalogueLoad> {
  const c = loadDiscoveryConfig(env);
  if (!c.ok) throw new Error(`discovery source not configured: ${c.reason}`);
  const now = deps.nowMs ?? Date.now;
  const cache = deps.cache ?? sharedCache;
  let fetched = false;
  const hit = await cache.get(c.config, async () => {
    fetched = true;
    const fetchedAtMs = now();
    return { raw: await fetchCatalogue(c.config, c.token, deps.fetchImpl, fetchedAtMs), fetchedAtMs };
  });
  const report = normalizeCatalogue(hit.raw, {
    config: c.config, allow: { tags: DISCOVERY_TAGS, areas: AREA_KEYS, hosts: SOURCE_HOST_FOR[c.config.source] },
    fetchedAtMs: hit.fetchedAtMs, nowMs: now(),
  });
  return { ...report, config: c.config, provenance: provenance(c.config, hit.fetchedAtMs), fromCache: !fetched };
}
