/**
 * DS consumer proposal for C8 discovery (contracts/specs/DISCOVERY.md). NOT a contract type: these shapes state what
 * the shortlist and the discover-results component need from CS's authorized candidate query and Sumedh's guards.
 * Replace with the reviewed `@kinetic/contracts` C8 exports once they land; do not publish these as wire schemas.
 *
 * Every field is either a published (opted-in) profile/intent field or a server-computed eligibility flag.
 * There is no location, distance, journal, support preference, quiz extra or contact detail anywhere here.
 */

/** Published per-event intention (C8 EventIntent projection). "interested"/"going" is self-declared, never attendance. */
export interface PublishedEventIntent {
  /** Canonical C7 catalogue event ID. */
  eventId: string;
  intent: 'interested' | 'going';
  /** Capped by the event end and the publication expiry. */
  expiresAt: string;
}

/** One authorized candidate row as the viewer may see it (C8 DiscoveryCard projection plus eligibility flags). */
export interface DiscoveryCandidate {
  /** Opaque, server-issued reference. Never an account, Clerk or SpacetimeDB identity. */
  ref: string;
  /** Chosen public display name (bounded). Untrusted text: displayed, never ranked. */
  displayName: string;
  /** Approved media ID, or null for an initials avatar. Never an arbitrary URL. */
  avatarMediaId: string | null;
  /** Published interest tags: slugs from the developer allowlist. */
  tags: string[];
  /** Currently published event intents. */
  eventIntents: PublishedEventIntent[];
  publicationVersion: number;
  publicationExpiresAt: string;
  /** Computed by the server for this viewer. The ranker re-checks them; it never relaxes one. */
  withdrawn: boolean;
  /** Either direction. */
  blocked: boolean;
  alreadyConnected: boolean;
}

/** The viewer's own publication state. Only published fields are ranking inputs; private quiz extras never are. */
export interface DiscoveryViewer {
  ref: string;
  published: boolean;
  tags: string[];
  eventIntents: PublishedEventIntent[];
}

/** Nearby: any eligible candidate in the viewer's area. Event: companions for one catalogue event. */
export type DiscoveryMode =
  | { kind: 'nearby' }
  /** `eventTags`: the event's normalized catalogue topics (public data), used only for the overlap reason. */
  | { kind: 'event'; eventId: string; eventTags: string[] };

/** Allowed explanation codes. There is no compatibility percentage. */
export const REASON_CODES = ['shared_interest', 'same_event', 'event_fits_shared_interest'] as const;
export type ReasonCode = typeof REASON_CODES[number];

export interface ShortlistEntry {
  ref: string;
  reasons: ReasonCode[];
  /** Tags both people published (sorted). */
  sharedTags: string[];
  /** Event both people currently published an intent for, if any. */
  sharedEventId: string | null;
  /** The candidate's own published intent for that event. */
  theirIntent: PublishedEventIntent['intent'] | null;
}

export type ExclusionReason =
  | 'invalid_card' | 'self' | 'blocked' | 'withdrawn' | 'expired_publication' | 'already_connected' | 'duplicate'
  | 'over_cap' | 'no_event_intent';

export type NoShortlistReason =
  /** Viewer has not published: discovery is opt-in for both sides. */
  | 'not_published'
  /** Viewer published no tags and no current event intent: nothing to overlap on (cold start). */
  | 'viewer_has_nothing_published'
  /** Event mode, but the viewer has no current intent for that event. */
  | 'viewer_no_event_intent'
  /** No eligible candidate remains. */
  | 'empty_area'
  /** Eligible candidates exist but none overlaps. */
  | 'no_fit';

export type DiscoveryShortlist =
  | { kind: 'shortlist'; mode: DiscoveryMode['kind']; entries: ShortlistEntry[]; excluded: { ref: string | null; reason: ExclusionReason }[]; truncated: boolean }
  | { kind: 'none'; mode: DiscoveryMode['kind']; reason: NoShortlistReason; excluded: { ref: string | null; reason: ExclusionReason }[]; truncated: boolean };
