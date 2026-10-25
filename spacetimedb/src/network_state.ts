// Network (D045): friend-of-friend reach over dor's own links. Index lookups only; shared by views and reducers.
import type { Identity } from 'spacetimedb';
import { guardDiscoveryVisibility } from '@dor/contracts/policy';
import { blockedEitherWay, discoveryEnabled, hex, loadDiscoveryParty, pairsOf, type ReadDb } from './policy_state';

/** A friend of a friend is 2 hops away; a friend of a friend of a friend is 3. Nothing further is reachable. */
export const MAX_HOPS = 3;
export const FOF_CARD_LIMIT = 20;
export const MAX_PENDING_NUDGE_REQUESTS = 20;

export interface Reach {
  who: Identity;
  hops: number;
  /** The caller's own direct friend the closest path goes through (the "X" in "someone X knows"). */
  via: Identity;
  /** Distinct direct friends of the caller that lead here at the shortest distance. */
  mutualCount: number;
}

/** Direct links: accepted pairs and accepted introductions. */
export function friendsOf(db: ReadDb, me: Identity): Identity[] {
  const out = new Map<string, Identity>();
  for (const p of pairsOf(db, me)) {
    if (p.status !== 'accepted' || !p.member_b) continue;
    const other = p.member_a.isEqual(me) ? p.member_b : p.member_a;
    out.set(hex(other), other);
  }
  for (const r of db.introduction.sender.filter(me)) if (r.status === 'accepted') out.set(hex(r.recipient), r.recipient);
  for (const r of db.introduction.recipient.filter(me)) if (r.status === 'accepted') out.set(hex(r.sender), r.sender);
  return [...out.values()];
}

/** The caller's coarse area: their profile's home area, else their discovery area. '' = none set. */
export function areaOf(db: ReadDb, who: Identity): string {
  const detail = db.profile_detail.owner.find(who);
  if (detail?.home_area) return detail.home_area;
  const a = db.area_participation.owner.find(who);
  return a?.active ? a.area_key : '';
}

export function interestsOf(db: ReadDb, who: Identity): string[] {
  const detail = db.profile_detail.owner.find(who);
  if (detail && detail.interests.length > 0) return detail.interests;
  for (const p of db.discovery_publication.owner.filter(who)) if (!p.withdrawn_at) return p.interest_tags;
  return [];
}

export const nameOf = (db: ReadDb, who: Identity): string => db.account.identity.find(who)?.display_name ?? 'Someone';

/**
 * Breadth-first reach from the caller up to MAX_HOPS, starting from their direct friends. Returns everyone at
 * distance 2..MAX_HOPS (direct friends and the caller are excluded), each with the friend the shortest path uses.
 */
export function reachFrom(db: ReadDb, me: Identity): Reach[] {
  const seen = new Map<string, Reach>();
  const meHex = hex(me);
  let frontier: Reach[] = friendsOf(db, me).map(f => ({ who: f, hops: 1, via: f, mutualCount: 1 }));
  for (const f of frontier) seen.set(hex(f.who), f);
  for (let hops = 2; hops <= MAX_HOPS && frontier.length > 0; hops++) {
    const next = new Map<string, Reach>();
    for (const from of frontier) {
      for (const n of friendsOf(db, from.who)) {
        const key = hex(n);
        if (key === meHex || seen.has(key)) continue;
        const prior = next.get(key);
        if (prior) {
          if (!prior.via.isEqual(from.via)) next.set(key, { ...prior, mutualCount: prior.mutualCount + 1 });
          continue;
        }
        next.set(key, { who: n, hops, via: from.via, mutualCount: 1 });
      }
    }
    for (const [k, r] of next) seen.set(k, r);
    frontier = [...next.values()];
  }
  return [...seen.values()].filter(r => r.hops >= 2);
}

export interface Candidate extends Reach { publicationId: string; sharedTags: string[] }

/** Reachable people in the caller's area, not blocked, ranked: closer, more mutual friends, more shared interests. */
export function nearbyCandidates(db: ReadDb, me: Identity): Candidate[] {
  const viewer = loadDiscoveryParty(db, me);
  if (!discoveryEnabled(db) || !viewer.publication || !viewer.area) return [];
  const mine = viewer.publication.interestTags;
  const candidates: Candidate[] = [];
  for (const r of reachFrom(db, me)) {
    const target = loadDiscoveryParty(db, r.who);
    if (!target.publication || !target.area) continue;
    if (!guardDiscoveryVisibility(viewer, target, blockedEitherWay(db, me, r.who), true, null).ok) continue;
    candidates.push({ ...r, publicationId: target.publication.publicationId,
      sharedTags: target.publication.interestTags.filter(t => mine.includes(t)) });
  }
  return candidates.sort((a, b) => a.hops - b.hops || b.mutualCount - a.mutualCount || b.sharedTags.length - a.sharedTags.length ||
    (a.publicationId < b.publicationId ? -1 : a.publicationId > b.publicationId ? 1 : 0));
}

/** The latest nudge request between two people in either direction, if any. */
export function requestBetween(db: ReadDb, a: Identity, b: Identity) {
  let latest;
  for (const r of db.nudge_request.sender.filter(a)) {
    if (r.recipient.isEqual(b) && (!latest || r.created_at.microsSinceUnixEpoch > latest.created_at.microsSinceUnixEpoch)) latest = r;
  }
  for (const r of db.nudge_request.sender.filter(b)) {
    if (r.recipient.isEqual(a) && (!latest || r.created_at.microsSinceUnixEpoch > latest.created_at.microsSinceUnixEpoch)) latest = r;
  }
  return latest;
}
