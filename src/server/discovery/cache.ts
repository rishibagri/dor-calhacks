/**
 * In-memory catalogue cache keyed by source/region/window with a TTL and single-flight coalescing. Callers
 * (routes, scripts) ask the cache; only a miss reaches Apify, so no render ever triggers an Actor run.
 * A failed load is not cached (the next caller may retry after the TTL-independent failure) but is coalesced.
 */
import type { DiscoveryConfig } from './config.ts';

export function cacheKey(c: DiscoveryConfig): string {
  return [c.source, c.actorId, c.region.key, `${c.windowDays}d`, c.topics.join('+'), c.maxItems].join('|');
}

export class CatalogueCache<T> {
  private readonly entries = new Map<string, { at: number; value: T }>();
  private readonly inflight = new Map<string, Promise<T>>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  async get(config: DiscoveryConfig, load: () => Promise<T>): Promise<T> {
    const key = cacheKey(config);
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < config.cacheTtlMs) return hit.value;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = load().then((value) => { this.entries.set(key, { at: this.now(), value }); return value; })
      .finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, p);
    return p;
  }

  clear(): void { this.entries.clear(); }
}
