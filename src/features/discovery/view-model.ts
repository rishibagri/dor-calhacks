/**
 * Pure presentation logic for discovery results (DS). Turns a shortlist plus the authorized candidate page into
 * what a card may show. Shown fields are exactly the published projection: display name, avatar, published tags and
 * the overlap reasons. No percentage, distance, "nearby now" or attendance claim is ever produced.
 */
import type { ActivityItem, ActivityRankResult, RationaleCode } from '../../evaluation/rank.ts';
import type { DiscoveryCandidate, DiscoveryShortlist, NoShortlistReason, PublishedEventIntent, ShortlistEntry } from './types.ts';

/** "board-games" → "Board games". Slugs come from the developer allowlist, so this is display only. */
export function tagLabel(slug: string): string {
  const words = slug.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Self-declared intent, never verified attendance. */
export const INTENT_LABEL: Record<PublishedEventIntent['intent'], string> = {
  interested: 'Interested',
  going: 'Planning to go',
};

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** One plain sentence per reason code, in a fixed order. */
export function reasonLines(entry: ShortlistEntry, eventTitle?: string): string[] {
  const lines: string[] = [];
  if (entry.reasons.includes('shared_interest'))
    lines.push(`You both picked ${joinList(entry.sharedTags.map(t => tagLabel(t).toLowerCase()))}.`);
  if (entry.reasons.includes('same_event') && entry.theirIntent)
    lines.push(`You both published an intention for ${eventTitle ?? 'the same event'} (they said: ${INTENT_LABEL[entry.theirIntent].toLowerCase()}).`);
  if (entry.reasons.includes('event_fits_shared_interest'))
    lines.push('The event matches an interest you share.');
  return lines;
}

export interface CardView {
  ref: string;
  displayName: string;
  initials: string;
  avatarMediaId: string | null;
  tags: { slug: string; label: string; shared: boolean }[];
  reasons: string[];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map(p => Array.from(p)[0]!.toUpperCase()).join('') || '?';
}

/**
 * Joins shortlist entries to their authorized rows. An entry without a matching row is dropped (never shown with
 * invented fields).
 */
export function toCardViews(shortlist: DiscoveryShortlist, candidates: DiscoveryCandidate[], eventTitle?: string): CardView[] {
  if (shortlist.kind !== 'shortlist') return [];
  const byRef = new Map(candidates.map(c => [c.ref, c]));
  return shortlist.entries.flatMap(entry => {
    const c = byRef.get(entry.ref);
    if (!c) return [];
    const shared = new Set(entry.sharedTags);
    return [{
      ref: c.ref, displayName: c.displayName, initials: initials(c.displayName), avatarMediaId: c.avatarMediaId,
      tags: c.tags.map(slug => ({ slug, label: tagLabel(slug), shared: shared.has(slug) })),
      reasons: reasonLines(entry, eventTitle),
    }];
  });
}

export type EmptyAction = 'publish_profile' | 'add_interests' | 'publish_event_intent' | 'browse_events' | null;
export interface EmptyState { title: string; body: string; action: EmptyAction }

/** Honest empty states. They never suggest that someone is nearby when no one is. */
export function emptyState(reason: NoShortlistReason, mode: 'nearby' | 'event'): EmptyState {
  switch (reason) {
    case 'not_published':
      return { title: 'Discovery is off', body: 'Publish a discovery profile to see others who chose to be found. You choose exactly what it shows.', action: 'publish_profile' };
    case 'viewer_has_nothing_published':
      return { title: 'Add a few interests', body: 'Suggestions come from interests or event plans you both published. Add some, or browse public events.', action: 'add_interests' };
    case 'viewer_no_event_intent':
      return { title: 'Say you are interested first', body: 'Event companions are shown only to people who published an intention for the event themselves.', action: 'publish_event_intent' };
    case 'empty_area':
      return mode === 'event'
        ? { title: 'No one else yet', body: 'No one else has published an intention for this event. You can still go, or check back later.', action: 'browse_events' }
        : { title: 'No one in your selected area yet', body: 'No one else in your selected area has published a discovery profile right now. Public events are a good way to start.', action: 'browse_events' };
    case 'no_fit':
      return { title: 'No shared interests yet', body: 'People are discoverable in your selected area, but none share the interests you published. Try adding interests or browse public events.', action: 'browse_events' };
  }
}

// ---- Event (activity catalogue) cards ----

export interface EventCardView {
  activityId: string;
  title: string;
  sourceSite: string;
  format: 'Online' | 'In person';
  when: string;
  duration: string | null;
  freshness: string;
  reasons: string[];
}

const RATIONALE_LABEL: Record<RationaleCode, string | null> = {
  scheduled_moment: 'Has a set time within your window',
  on_demand: 'Available any time',
  short_duration: 'Short',
  mutual_interest: 'Matches an interest you both approved',
  cached_source: null,
};

function formatWhen(item: ActivityItem, utcOffsetMinutes: number): string {
  if (item.schedule.kind === 'on_demand') return 'Any time';
  if (item.schedule.kind === 'unknown') return 'Time not confirmed';
  const local = new Date(Date.parse(item.schedule.startAt) + utcOffsetMinutes * 60_000);
  const day = local.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const time = local.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  return `${day}, ${time}`;
}

/** Age of the catalogue observation; prices/tickets are never implied. */
export function freshnessLabel(fetchedAt: string, freshness: ActivityItem['freshness'], now: Date): string {
  const hours = Math.max(0, Math.round((now.getTime() - Date.parse(fetchedAt)) / 3_600_000));
  const age = hours < 1 ? 'less than an hour ago' : hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  return freshness === 'fresh' ? `Listing checked ${age}` : `Saved listing from ${age}; details may have changed`;
}

export function toEventCardViews(result: ActivityRankResult, items: ActivityItem[], now: Date, utcOffsetMinutes: number): EventCardView[] {
  if (result.kind !== 'ranked') return [];
  const byId = new Map(items.map(i => [i.activityId, i]));
  return result.suggestions.flatMap(s => {
    const item = byId.get(s.activityId);
    if (!item) return [];
    return [{
      activityId: item.activityId, title: item.title.slice(0, 120), sourceSite: item.sourceSite,
      format: item.format === 'online' ? 'Online' : 'In person', when: formatWhen(item, utcOffsetMinutes),
      duration: item.durationMinutes === null ? null : `${item.durationMinutes} min`,
      freshness: freshnessLabel(item.fetchedAt, item.freshness, now),
      reasons: s.rationale.map(r => RATIONALE_LABEL[r]).filter((l): l is string => l !== null),
    }];
  });
}

/** Empty states for event (catalogue) results, including a source outage reported by CS. */
export function eventEmptyState(reason: Exclude<ActivityRankResult, { kind: 'ranked' }>['reason'] | 'source_unavailable'): EmptyState {
  switch (reason) {
    case 'source_unavailable':
      return { title: 'Events are unavailable right now', body: 'We could not load public events. Nothing shown here is made up; please try again later.', action: null };
    case 'empty_catalogue':
      return { title: 'No public events loaded', body: 'There are no saved public events for your area yet.', action: null };
    case 'no_eligible_activity':
      return { title: 'Nothing fits this time', body: 'No upcoming public event fits the time you both chose.', action: null };
    case 'no_strong_match':
      return { title: 'No good fit yet', body: 'The events we found are too long or loosely scheduled to suggest. Check back later.', action: null };
    case 'no_agreed_option':
    case 'not_shared_activity':
      return { title: 'No activity requested', body: 'Event ideas appear only after you both agreed to do something together.', action: null };
  }
}
