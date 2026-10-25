/**
 * Catalogue places (D051 proposal): public places worth going to near each launch area, such as well-reviewed food
 * and coffee, from a developer-configured Apify source (Google Maps). Like catalogue events, a place record is
 * public, untrusted source data written only by the server ingester; it is never joined to a person, and it never
 * carries reviews, reviewer names, contact details, opening hours or coordinates. Runtime-dependency-free so the
 * SpacetimeDB module enforces the same rules (re-exported from `@dor/contracts/policy`).
 */
import { safeCatalogueUrl } from './catalogue.js';

/** Fixed place kinds; each ingest query is for exactly one kind, so the kind comes from the query, never the text. */
export const PLACE_KINDS = ['food', 'coffee', 'dessert', 'study', 'bar', 'park', 'books', 'museum', 'fitness', 'music', 'art', 'games'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];
export const MAX_PLACE_NAME = 80;
export const MAX_PLACE_LABEL = 40;
export const MAX_PLACE_REVIEWS = 10_000_000;

export type PlaceDenyReason = 'invalid_schema' | 'area_not_allowlisted' | 'unsafe_source_url';

export interface CataloguePlaceInput {
  placeId: string;
  name: string;
  kind: PlaceKind;
  /** The source's own category text ("Indian restaurant"), display only. */
  label: string;
  /** Average rating × 10 (0–50), so 4.6 stars is 46. */
  ratingTenths: number;
  reviewCount: number;
  /** Configured coarse area the place is in. Never an address or coordinate. */
  areaKey: string;
  sourceUrl: string | null;
  fetchedAtMs: number;
}
const PLACE_KEYS = ['placeId', 'name', 'kind', 'label', 'ratingTenths', 'reviewCount', 'areaKey', 'sourceUrl', 'fetchedAtMs'];
const PLACE_ID_RE = /^[a-z0-9][a-z0-9:_-]{2,127}$/;
// Control, bidi-override and zero-width characters; markup brackets. Scraped text is display-only data.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿<>]/g;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const clean = (s: string, max: number) => s.normalize('NFKC').replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Default deny: unknown keys are rejected, text is display-only and cleaned, the area must be allowlisted. */
export function guardCataloguePlace(input: unknown, allow: { areas: readonly string[]; hosts: readonly string[] }, nowMs: number):
  { ok: true; place: CataloguePlaceInput } | { ok: false; reason: PlaceDenyReason } {
  const no = (reason: PlaceDenyReason) => ({ ok: false as const, reason });
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Number.isFinite(nowMs)) return no('invalid_schema');
  const p = input as Record<string, unknown>;
  if (Object.keys(p).some((k) => !PLACE_KEYS.includes(k))) return no('invalid_schema');
  if (typeof p.placeId !== 'string' || !PLACE_ID_RE.test(p.placeId)) return no('invalid_schema');
  if (typeof p.name !== 'string' || typeof p.label !== 'string') return no('invalid_schema');
  const name = clean(p.name, MAX_PLACE_NAME), label = clean(p.label, MAX_PLACE_LABEL);
  if (!name) return no('invalid_schema');
  if (!(PLACE_KINDS as readonly unknown[]).includes(p.kind)) return no('invalid_schema');
  if (!Number.isSafeInteger(p.ratingTenths) || (p.ratingTenths as number) < 0 || (p.ratingTenths as number) > 50) return no('invalid_schema');
  if (!Number.isSafeInteger(p.reviewCount) || (p.reviewCount as number) < 0 || (p.reviewCount as number) > MAX_PLACE_REVIEWS) return no('invalid_schema');
  if (!Number.isSafeInteger(p.fetchedAtMs) || (p.fetchedAtMs as number) > nowMs + MAX_CLOCK_SKEW_MS) return no('invalid_schema');
  if (typeof p.areaKey !== 'string' || !allow.areas.includes(p.areaKey)) return no('area_not_allowlisted');
  let sourceUrl: string | null = null;
  if (p.sourceUrl !== null) {
    sourceUrl = safeCatalogueUrl(p.sourceUrl, allow.hosts);
    if (!sourceUrl) return no('unsafe_source_url');
  }
  return { ok: true, place: { placeId: p.placeId, name, kind: p.kind as PlaceKind, label, ratingTenths: p.ratingTenths as number,
    reviewCount: p.reviewCount as number, areaKey: p.areaKey, sourceUrl, fetchedAtMs: p.fetchedAtMs as number } };
}

/**
 * Catalogue detail (D057): public, display-and-matching text for one catalogue event or place, written only by the
 * ingester from the same scrape. A short summary, keyword slugs, a price label and the public venue name. Never a person,
 * contact, review text, address or coordinate. Untrusted source data: matching may read it; it never grants anything.
 */
export const MAX_DETAIL_SUMMARY = 280;
export const MAX_DETAIL_KEYWORDS = 12;
export const MAX_DETAIL_KEYWORD = 30;
export const MAX_DETAIL_LABEL = 60;
export interface CatalogueDetailInput {
  itemId: string;
  itemKind: 'event' | 'place';
  summary: string;
  keywords: string[];
  priceLabel: string;
  venue: string;
  fetchedAtMs: number;
}
const DETAIL_KEYS = ['itemId', 'itemKind', 'summary', 'keywords', 'priceLabel', 'venue', 'fetchedAtMs'];
const ITEM_ID_RE = /^[a-z0-9][a-z0-9:_-]{2,127}$/;
const URLISH = /(https?:\/\/|www\.)\S*/gi;
const EMAILISH = /\S+@\S+\.\S+/g;
const PHONEISH = /\+?\d[\d\s().-]{7,}\d/g;
/** Lowercase slug: letters, digits and single hyphens. */
export const keywordSlug = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_DETAIL_KEYWORD);
const cleanDetail = (s: string, max: number) => clean(s.replace(URLISH, ' ').replace(EMAILISH, ' ').replace(PHONEISH, ' '), max);

/** Default deny: unknown keys rejected; text cleaned of markup, links, emails and phone numbers; keywords slugged. */
export function guardCatalogueDetail(input: unknown, nowMs: number):
  { ok: true; detail: CatalogueDetailInput } | { ok: false; reason: 'invalid_schema' } {
  const no = { ok: false as const, reason: 'invalid_schema' as const };
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Number.isFinite(nowMs)) return no;
  const d = input as Record<string, unknown>;
  if (Object.keys(d).some((k) => !DETAIL_KEYS.includes(k))) return no;
  if (typeof d.itemId !== 'string' || !ITEM_ID_RE.test(d.itemId)) return no;
  if (d.itemKind !== 'event' && d.itemKind !== 'place') return no;
  if (typeof d.summary !== 'string' || typeof d.priceLabel !== 'string' || typeof d.venue !== 'string') return no;
  if (!Array.isArray(d.keywords) || d.keywords.length > 40 || !d.keywords.every((k) => typeof k === 'string')) return no;
  if (!Number.isSafeInteger(d.fetchedAtMs) || (d.fetchedAtMs as number) > nowMs + MAX_CLOCK_SKEW_MS) return no;
  const keywords = [...new Set((d.keywords as string[]).map(keywordSlug).filter((k) => k.length >= 2))].slice(0, MAX_DETAIL_KEYWORDS);
  return { ok: true, detail: { itemId: d.itemId, itemKind: d.itemKind, summary: cleanDetail(d.summary, MAX_DETAIL_SUMMARY), keywords,
    priceLabel: cleanDetail(d.priceLabel, 20), venue: cleanDetail(d.venue, MAX_DETAIL_LABEL), fetchedAtMs: d.fetchedAtMs as number } };
}
