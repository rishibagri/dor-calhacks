/**
 * PROPOSED C7 privacy boundary for public activity discovery (Cyber, D028; CS/DS/AI review pending).
 * Not a C7 catalogue/proposal type and not an activity-sharing permission: it only constrains what may
 * be SENT to Apify and which source URLs may be SHOWN. Runtime-dependency-free.
 *
 * Apify inputs are generic and identical for every user: developer-allowlisted topics, a format and a
 * limit. Journals, quiz answers/extras, detailed calendars, relationship labels, person/pair IDs and any
 * user-typed text are structurally impossible to pass (unknown keys and free text are rejected).
 */

import { looksSensitiveTag } from './discovery.js';

export interface PublicCatalogueQuery {
  format: 'online' | 'in_person' | 'any';
  /** Each topic must appear in the developer-configured allowlist; never user text. */
  topics: string[];
  limit: number;
  locale?: string;
}
export type CatalogueQueryDecision =
  | { ok: true; query: PublicCatalogueQuery }
  | { ok: false; reason: 'not_object' | 'unknown_field' | 'invalid_value' | 'topic_not_allowlisted' | 'looks_like_identifier' };

const QUERY_KEYS = ['format', 'topics', 'limit', 'locale'];
const TOPIC_RE = /^[a-z][a-z0-9-]{1,31}$/;
const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;
const MAX_TOPICS = 10;
const MAX_LIMIT = 100;
// Defence in depth against identifiers leaking through an allowlist mistake.
const IDENTIFIER_RES = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, // UUID
  /[0-9a-f]{32,}/i, // SpacetimeDB identity hex / hashes / tokens
  /[^\s@]+@[^\s@]+\.[^\s@]+/, // email
  /\d{7,}/, // phone-like / numeric ids
];
const looksLikeIdentifier = (s: string) => IDENTIFIER_RES.some(re => re.test(s));

/** Validates the developer allowlist itself: short lowercase slugs only. */
export function validTopicAllowlist(topics: readonly string[]): boolean {
  return topics.length > 0 && topics.every(t => TOPIC_RE.test(t) && !looksLikeIdentifier(t) && !looksSensitiveTag(t));
}

/** Default deny. Returns a fresh object containing only allowlisted fields (never the caller's object). */
export function guardPublicCatalogueQuery(input: unknown, allowedTopics: readonly string[]): CatalogueQueryDecision {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, reason: 'not_object' };
  const q = input as Record<string, unknown>;
  if (Object.keys(q).some(k => !QUERY_KEYS.includes(k))) return { ok: false, reason: 'unknown_field' };
  if (!validTopicAllowlist(allowedTopics)) return { ok: false, reason: 'topic_not_allowlisted' };
  if (q.format !== 'online' && q.format !== 'in_person' && q.format !== 'any') return { ok: false, reason: 'invalid_value' };
  if (!Number.isInteger(q.limit) || (q.limit as number) < 1 || (q.limit as number) > MAX_LIMIT) return { ok: false, reason: 'invalid_value' };
  if (q.locale !== undefined && (typeof q.locale !== 'string' || !LOCALE_RE.test(q.locale))) return { ok: false, reason: 'invalid_value' };
  const topics = q.topics;
  if (!Array.isArray(topics) || topics.length === 0 || topics.length > MAX_TOPICS ||
    new Set(topics).size !== topics.length) return { ok: false, reason: 'invalid_value' };
  for (const t of topics) {
    if (typeof t !== 'string') return { ok: false, reason: 'invalid_value' };
    if (looksLikeIdentifier(t)) return { ok: false, reason: 'looks_like_identifier' };
    if (!allowedTopics.includes(t)) return { ok: false, reason: 'topic_not_allowlisted' };
  }
  return { ok: true, query: { format: q.format, topics: [...topics] as string[], limit: q.limit as number,
    ...(q.locale !== undefined ? { locale: q.locale as string } : {}) } };
}

/**
 * Source links shown on catalogue cards: https only, host on the developer allowlist (exact or subdomain),
 * no credentials, default port, fragment dropped. Returns null when unsafe. Never fetch these server-side
 * without a separate SSRF review.
 */
export function safeCatalogueUrl(raw: unknown, allowedHosts: readonly string[]): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port !== '') return null;
  const host = u.hostname.toLowerCase();
  if (!allowedHosts.some(h => host === h || host.endsWith('.' + h))) return null;
  u.hash = '';
  return u.toString();
}
