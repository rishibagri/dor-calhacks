/**
 * Developer-configured catalogue feeds (CS-R3). One feed per launch area; topics are a subset of the discovery
 * tag allowlist. The Actor and its field map are configuration, not user input, and are reviewed with Cyber
 * before a paid run (D028 "geographic source configuration needs explicit Cyber review").
 */
import type { CatalogueFeed, SourceFieldMap } from './ingest.ts';

export const SOURCE_KEY = 'apify';

/**
 * Hosts whose links may appear on event cards (also loaded into the module as 'source_hosts'). Must cover every
 * host the Apify normalizer emits (`SOURCE_HOST_FOR`): Luma serves events from both lu.ma and luma.com.
 */
export const SOURCE_HOSTS: readonly string[] = ['eventbrite.com', 'meetup.com', 'lu.ma', 'luma.com'];

export const FEEDS: readonly CatalogueFeed[] = [
  { areaKey: 'berkeley-campus', topics: ['board-games', 'hiking', 'live-music', 'books'], format: 'in_person', limitPerTopic: 25, locale: 'en-US' },
];

/**
 * Where the Actor's dataset puts each field. Paths are dot-separated. Adjust per selected Actor; anything else
 * the Actor returns (venue, organizer, attendees, descriptions) is ignored and never stored.
 */
export const FIELD_MAP: SourceFieldMap = {
  title: 'title',
  startsAt: 'startDate',
  endsAt: 'endDate',
  url: 'url',
  cancelled: 'isCancelled',
};

/** At most one fetch per feed in this window (R4 budget). */
export const REFRESH_WINDOW_MS = 6 * 60 * 60 * 1000;
