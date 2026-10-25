/**
 * Fixed Apify source configuration (D045). Server-only: never import from a client component. `server-only` is not
 * installed, so this folder is kept out of client bundles by living under src/server and by never being imported
 * from src/app client code; the token never leaves `loadDiscoveryConfig`'s second return value.
 *
 * Nothing here is user-derived. Fails closed when token, approved Actor/source pair, or pinned build is missing.
 */
import { AREA_KEYS, DISCOVERY_TAGS } from '../../lib/discovery/config.ts';

export type SourceKind = 'luma' | 'meetup';

/** Hard ceilings, independent of env. */
export const MAX_ITEMS_CEILING = 50;
export const MAX_TIMEOUT_MS = 120_000;
export const MAX_RETRIES = 1;
export const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ACTOR_ID_RE = /^[A-Za-z0-9_.-]{1,64}[/~][A-Za-z0-9_.-]{1,64}$/;
const BUILD_RE = /^[A-Za-z0-9._-]{1,32}$/;
const APPROVED_ACTORS: Record<SourceKind, string> = { luma: 'tortuga/luma-scraper', meetup: 'filip_cicvarek/meetup-scraper' };

export interface DiscoveryConfig {
  readonly source: SourceKind;
  /** `user~name` form used in the URL path. */
  readonly actorId: string;
  readonly build: string;
  /** Public region, configured by the developer (never from a device). */
  readonly region: { readonly key: string; readonly city: string; readonly state: string; readonly country: string; readonly lumaCity: string; readonly radiusMiles: number };
  readonly areaKeys: readonly string[];
  /** Allowlisted topics; one capped request per topic, so a record's topic is the query's. */
  readonly topics: readonly string[];
  readonly maxItems: number;
  readonly windowDays: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly cacheTtlMs: number;
}

export type ConfigResult =
  | { ok: true; config: DiscoveryConfig; token: string }
  | { ok: false; reason: string };

const int = (v: string | undefined, d: number): number | null => {
  if (v === undefined || v === '') return d;
  return /^\d{1,9}$/.test(v) ? Number(v) : null;
};

export function loadDiscoveryConfig(env: Record<string, string | undefined>): ConfigResult {
  const token = env.APIFY_API_TOKEN?.trim();
  if (!token) return { ok: false, reason: 'missing_APIFY_API_TOKEN' };
  const source = (env.APIFY_SOURCE?.trim() || 'luma') as SourceKind;
  if (source !== 'luma' && source !== 'meetup') return { ok: false, reason: 'invalid_APIFY_SOURCE' };
  const actor = env.APIFY_ACTOR_ID?.trim();
  if (!actor || !ACTOR_ID_RE.test(actor)) return { ok: false, reason: 'missing_or_invalid_APIFY_ACTOR_ID' };
  if (actor.replace('~', '/') !== APPROVED_ACTORS[source]) return { ok: false, reason: 'unreviewed_APIFY_ACTOR_FOR_SOURCE' };
  const build = env.APIFY_ACTOR_BUILD?.trim();
  if (!build || !BUILD_RE.test(build)) return { ok: false, reason: 'missing_or_invalid_APIFY_ACTOR_BUILD' };
  const maxItems = int(env.APIFY_MAX_ITEMS, 25);
  const timeoutMs = int(env.APIFY_TIMEOUT_MS, 90_000);
  const windowDays = int(env.APIFY_WINDOW_DAYS, 14);
  if (maxItems === null || maxItems < 1 || maxItems > MAX_ITEMS_CEILING) return { ok: false, reason: 'invalid_APIFY_MAX_ITEMS' };
  if (timeoutMs === null || timeoutMs < 1000 || timeoutMs > MAX_TIMEOUT_MS) return { ok: false, reason: 'invalid_APIFY_TIMEOUT_MS' };
  if (windowDays === null || windowDays < 1 || windowDays > 60) return { ok: false, reason: 'invalid_APIFY_WINDOW_DAYS' };
  const topics = (env.APIFY_TOPICS?.trim() || 'board-games,live-music').split(',').map((t) => t.trim());
  if (topics.length === 0 || topics.length > 5 || !topics.every((t) => DISCOVERY_TAGS.includes(t))) return { ok: false, reason: 'invalid_APIFY_TOPICS' };
  return {
    ok: true, token,
    config: {
      source, actorId: actor.replace('/', '~'), build,
      region: { key: 'berkeley-ca', city: 'Berkeley', state: 'CA', country: 'us', lumaCity: 'sf', radiusMiles: 5 },
      areaKeys: AREA_KEYS.filter((k) => k.startsWith('berkeley-')),
      topics, maxItems, windowDays, timeoutMs, maxRetries: MAX_RETRIES, cacheTtlMs: DEFAULT_CACHE_TTL_MS,
    },
  };
}
