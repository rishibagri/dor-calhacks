/**
 * C8 → DS ranker adapter (DS-R1/R2). The only path from real `discovery_cards` rows (Cyber's reviewed
 * `DiscoveryCardProjection`) to ranker candidates. Pure: no I/O, no clock reads.
 *
 * Strict, never repairing: a row with any key outside the projection, an out-of-bounds or contact-like name, an
 * unallowlisted or duplicate tag, or `sharedTags` that differ from the overlap computed here is rejected, so a server
 * projection bug fails visibly instead of ranking.
 *
 * Fields the projection does not carry are filled conservatively, never invented:
 * - `avatarMediaId: null` (initials avatar) and `sharedEventIds: []`: mutual events are joined only from the D039
 *   `event_companions` view (src/evaluation/events.ts), never inferred here;
 * - `publicationExpiresAt: null`: expiry is enforced by the view and its sweep, not visible to peers;
 * - `withdrawn`/`blocked: false`: the view already drops those rows (guardDiscoveryVisibility);
 * - `alreadyConnected: false`: nothing computes it for discovery yet (open gap, raised to CS/Cyber).
 */
import { looksLikeContactOrId, MAX_INTEREST_TAGS, MAX_PUBLIC_NAME, type DiscoveryCardProjection } from '@dor/contracts/policy';
import { rankNearby, type NearbyInput } from '../../evaluation/nearby.ts';
import type { DiscoveryCandidate, DiscoveryShortlist, ShortlistEntry } from './types.ts';

const ROW_KEYS = new Set<string>(['cardRef', 'displayName', 'interestTags', 'sharedTags', 'revision'] satisfies (keyof DiscoveryCardProjection)[]);
const TAG_RE = /^[a-z][a-z0-9-]{1,31}$/;
const MAX_REF = 128;
// Control, bidi-override and zero-width characters (same class the publication guard refuses).
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/;

export type CardRejection = 'invalid_card' | 'shared_tags_mismatch';
export interface CardAdapterResult {
  candidates: DiscoveryCandidate[];
  rejected: { ref: string | null; reason: CardRejection }[];
}

const refOf = (row: unknown) => {
  const r = typeof row === 'object' && row !== null ? (row as { cardRef?: unknown }).cardRef : undefined;
  return typeof r === 'string' && r.length > 0 && r.length <= MAX_REF ? r : null;
};

function validTags(v: unknown, allowed: ReadonlySet<string>, max: number): v is string[] {
  return Array.isArray(v) && v.length <= max && new Set(v).size === v.length &&
    v.every(t => typeof t === 'string' && TAG_RE.test(t) && allowed.has(t));
}

/** One projection row → ranker candidate, or why it was rejected. */
export function fromDiscoveryCard(row: unknown, viewerTags: readonly string[], allowedTags: ReadonlySet<string>):
  DiscoveryCandidate | CardRejection {
  if (typeof row !== 'object' || row === null || Array.isArray(row) || !Object.keys(row).every(k => ROW_KEYS.has(k)))
    return 'invalid_card';
  const r = row as Record<string, unknown>;
  const ref = refOf(row), name = r.displayName;
  const ok = ref !== null && typeof name === 'string' && name.length > 0 && name.length <= MAX_PUBLIC_NAME &&
    !UNSAFE_CHARS.test(name) && !looksLikeContactOrId(name) &&
    validTags(r.interestTags, allowedTags, MAX_INTEREST_TAGS) && validTags(r.sharedTags, allowedTags, MAX_INTEREST_TAGS) &&
    Number.isSafeInteger(r.revision) && (r.revision as number) > 0;
  if (!ok) return 'invalid_card';
  const tags = r.interestTags as string[];
  const viewer = new Set(viewerTags);
  const overlap = tags.filter(t => viewer.has(t)).sort();
  if (overlap.join() !== [...(r.sharedTags as string[])].sort().join()) return 'shared_tags_mismatch';
  return {
    ref, displayName: name, avatarMediaId: null, tags: [...tags], sharedEventIds: [], publicationVersion: r.revision as number,
    publicationExpiresAt: null, withdrawn: false, blocked: false, alreadyConnected: false,
  };
}

/** Maps a `discovery_cards` page; rejected rows are reported, never passed on. */
export function fromDiscoveryCards(rows: readonly unknown[], viewerTags: readonly string[], allowedTags: readonly string[]):
  CardAdapterResult {
  const allowed = new Set(allowedTags);
  const out: CardAdapterResult = { candidates: [], rejected: [] };
  for (const row of rows) {
    const c = fromDiscoveryCard(row, viewerTags, allowed);
    if (typeof c === 'string') out.rejected.push({ ref: refOf(row), reason: c });
    else out.candidates.push(c);
  }
  return out;
}

/**
 * Adapter + `rankNearby` in one call for the Discover page. Rejected rows appear in `excluded` as `invalid_card`
 * (the detailed reason stays in `rejected`). Also returns the candidates so cards can be joined by ref.
 */
export function rankDiscoveryCards(input: Omit<NearbyInput, 'candidates'> & { rows: readonly unknown[] }):
  { shortlist: DiscoveryShortlist; candidates: DiscoveryCandidate[]; rejected: CardAdapterResult['rejected'] } {
  const { rows, ...rest } = input;
  const { candidates, rejected } = fromDiscoveryCards(rows, input.viewer.tags, input.allowedTags);
  const ranked = rankNearby({ ...rest, candidates });
  const shortlist = { ...ranked, excluded: [...rejected.map(r => ({ ref: r.ref, reason: 'invalid_card' as const })), ...ranked.excluded] };
  return { shortlist, candidates, rejected };
}

/** D038(e): the server's `commit_introduction_proposal` accepts at most this many shared tags. */
export const MAX_PROPOSAL_TAGS = 3;

/**
 * D038(e) gate for the AI introduction step: the server commits proposals for `shared_interest` only, with 1–3 tags
 * both people publish, and refuses `same_event` (guardIntroductionProposalCommit). An entry whose only overlap is an
 * event is therefore withheld, never sent for a model call that would be refused. Event companions stay visible on the
 * Discover page; only the proposal input is narrowed. Tags keep the ranker's sorted order.
 */
export function forIntroductionProposals(entries: readonly ShortlistEntry[]):
  { ready: { ref: string; reasons: ['shared_interest']; sharedTags: string[]; sharedEventId: null }[]; withheld: string[] } {
  const ready: { ref: string; reasons: ['shared_interest']; sharedTags: string[]; sharedEventId: null }[] = [];
  const withheld: string[] = [];
  for (const e of entries) {
    if (!e.reasons.includes('shared_interest') || e.sharedTags.length === 0) { withheld.push(e.ref); continue; }
    ready.push({ ref: e.ref, reasons: ['shared_interest'], sharedTags: e.sharedTags.slice(0, MAX_PROPOSAL_TAGS), sharedEventId: null });
  }
  return { ready, withheld };
}
