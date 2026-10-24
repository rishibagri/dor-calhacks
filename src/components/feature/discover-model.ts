/**
 * Pure helpers for the Discover page (CS-R2, C8). The module re-validates everything (guardPublicationDraft,
 * guardAreaKey, guardIntroductionRequest); these only shape input and give early, honest feedback.
 */
import {
  DISCOVERY_CARD_LIMIT, DISCOVERY_AUDIENCES, DISCOVERY_NOTICE_VERSION, MAX_INTEREST_TAGS, PUBLICATION_MAX_LIFETIME_MS, guardPublicationDraft,
} from '@dor/contracts/policy';
import type { DiscoveryCardRow, MyDiscoveryView } from '../../lib/backend/ports.ts';
import { rankDiscoveryCards } from '../../features/discovery/adapters.ts';
import type { DiscoveryViewer } from '../../features/discovery/types.ts';
import { AREA_KEYS, DISCOVERY_TAGS } from '../../lib/discovery/config.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Offered publication lengths; 7 days is trimmed by an hour so clock skew cannot exceed the server cap. */
export const PUBLICATION_DAYS = [1, 3, 7] as const;
export type PublicationDays = (typeof PUBLICATION_DAYS)[number];

export function publicationExpiry(nowMs: number, days: PublicationDays): string {
  return new Date(nowMs + Math.min(days * DAY_MS, PUBLICATION_MAX_LIFETIME_MS - DAY_MS / 24)).toISOString();
}

export interface ProfileDraft { displayName: string; interestTags: string[] }

/** Same guard the reducer runs, so a draft that fails here would fail there too. */
export function checkProfileDraft(draft: ProfileDraft, expiresAt: string, nowMs: number): { ok: true } | { ok: false; message: string } {
  if (draft.interestTags.length === 0) return { ok: false, message: 'Pick at least one interest.' };
  if (draft.interestTags.length > MAX_INTEREST_TAGS) return { ok: false, message: `Pick at most ${MAX_INTEREST_TAGS} interests.` };
  const d = guardPublicationDraft({
    displayName: draft.displayName.trim(), interestTags: draft.interestTags, audience: DISCOVERY_AUDIENCES[0],
    noticeVersion: DISCOVERY_NOTICE_VERSION, expiresAtMs: Date.parse(expiresAt),
  }, DISCOVERY_TAGS, nowMs);
  if (d.ok) return { ok: true };
  return { ok: false, message: DRAFT_DENIAL_COPY[d.reason] ?? 'This profile cannot be published as entered.' };
}

const DRAFT_DENIAL_COPY: Partial<Record<string, string>> = {
  looks_like_identifier: 'Use a first name or nickname, without contact details, links or handles.',
  invalid_schema: 'Use a name of 1 to 40 characters and the offered interests only.',
  tag_not_allowlisted: 'One of those interests is not offered here.',
};

export type DiscoverStage = 'disabled' | 'needs_profile' | 'needs_area' | 'ready';

/** What the page should ask for next. Withdrawn or expired profiles need an explicit new publish. */
export function discoverStage(me: MyDiscoveryView | null, nowMs: number): DiscoverStage {
  if (!me || !me.discoveryEnabled) return 'disabled';
  const live = me.published && !me.withdrawn && !me.expired && me.expiresAt !== null && Date.parse(me.expiresAt) > nowMs;
  if (!live) return 'needs_profile';
  const areaLive = me.areaActive && me.areaKey !== null && AREA_KEYS.includes(me.areaKey) &&
    me.areaExpiresAt !== null && Date.parse(me.areaExpiresAt) > nowMs;
  return areaLive ? 'ready' : 'needs_area';
}

export function viewerOf(me: MyDiscoveryView | null, stage: DiscoverStage): DiscoveryViewer {
  return {
    ref: me?.publicationId ?? 'self', published: stage === 'ready' || stage === 'needs_area',
    tags: me?.interestTags ?? [], eventIntents: [],
  };
}

/** discovery_cards → DS shortlist (≤ 3) through DS's strict adapter; never ranks a row it rejects. */
export function shortlistFor(me: MyDiscoveryView | null, rows: readonly DiscoveryCardRow[], now: Date) {
  const stage = discoverStage(me, now.getTime());
  return rankDiscoveryCards({
    rows, viewer: viewerOf(me, stage), mode: { kind: 'nearby' }, allowedTags: [...DISCOVERY_TAGS], now,
  });
}

/** Fresh ID per Send tap, matching the module's [A-Za-z0-9_-]{8,64} (validClientRequestId). */
export function newIntroductionRequestId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

/**
 * Paging over the caller's discovery_cards (server cursor, card-ref order). A full page means there may be more;
 * the next cursor is the last ref on this page. Only the caller's own cursor moves.
 */
export function nextPageCursor(rows: readonly DiscoveryCardRow[]): string | null {
  if (rows.length < DISCOVERY_CARD_LIMIT) return null;
  return rows.reduce((max, r) => (r.cardRef > max ? r.cardRef : max), '');
}
