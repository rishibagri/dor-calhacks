# Apify event source (D045): Actor comparison and adapter

Status: researched from public Apify Store pages only. NO Actor was run, no token was used, nothing is live or paid. Prices and fields below come from Store listings read on 2026-10-24 and must be re-checked on each Actor's Pricing/Input tab before a run. Store pages did not show a "last updated" date for any Actor (changelogs are separate); verify maintenance before spending.

## Candidates (events only)

| | Luma: `tortuga/luma-scraper` (recommended) | Luma: `northbell/luma-events-scraper` | Luma: `lexis-solutions/lu-ma-scraper` | Meetup: `filip_cicvarek/meetup-scraper` (recommended Meetup) | Meetup: `parsebird/meetup-events-scraper` |
|---|---|---|---|---|---|
| Maintainer | Trevor Ortega (community) | Northbell (community) | Lexis Solutions (Apify partner) | Filip Cicvarek (community) | ParseBird (community, new) |
| Usage signal | 2 users, 100% success | 2 users | n/a | ~540 users, 99.1% success, 4.93/5 | 2 users |
| Pricing | pay-per-event $0.0005/event, no start fee | ~$1.50/1k + $0.01/run | from $8/1k | from $0.50/1k + small start fee | from $0.39/1k (plan dependent) |
| Est. cost, 50 items | about $0.025 | about $0.09 | about $0.40 | about $0.03-0.05 | about $0.05 |
| Region input | `cities: ["sf"]` (Luma city slug; no Berkeley page, Bay Area) + optional `searchQuery` | `cities: ["sf"]` | free-text `query`/`location` | `city`, `state`, `country`, `radius` (miles), or `lat`/`lon` | search + location |
| Cap input | `maxItems` (total) | `maxEventsPerSource` | `maxItems` | `maxResults` (0 = unlimited, so we always send a cap) | maxResults |
| Stable id | `id` (`evt-...`) | none documented | `api_id` | `eventId` | n/a checked |
| Title / times | `name`; `startAt`/`endAt` ISO UTC; `timezone` IANA | `name`; `startAt`/`endAt`; `timezone` | `name`; `start_at`/`end_at` | `eventName`; `startDateTime`/`endDateTime`; `timezone` IANA | n/a checked |
| Venue / url | `venue{name,address,city,latitude,longitude}`, `url` | venue/lat/lon, `url` | geo_address_info | `venue{name,city,lat,lon}` (null online), `eventUrl` | n/a checked |

Attendee and personal data exposed (the adapter reads none of it):
- tortuga: `hosts` (public display names, usernames, profile URLs), `guestCount` (aggregate). States it never collects guest lists, attendee names, registration answers, emails or phones.
- filip_cicvarek: `actualAttendees` (RSVP count), `group.organizerName`, `organizerProfileUrl`; attendee identities not available (behind login). Page warns organizer names are personal data (GDPR).
- lexis: exposes organizers and attendee counts per its description.
Terms: all read public listings without login. Users are responsible for complying with Luma/Meetup terms and privacy law; we store only title, start/end, area, source URL and an opaque id. Have the owner skim both Terms pages before any production use.

## Recommendation

- Primary (Luma): `tortuga/luma-scraper`. Cheapest, no start fee, stable `evt-` id, UTC times, IANA timezone, venue lat/lon (used to assign `berkeley-campus` / `berkeley-downtown`), and documented no-guest-list behavior.
- Meetup (second source): `filip_cicvarek/meetup-scraper`. Most used and best rated, real Berkeley, CA geocoding with radius, stable `eventId`, IANA timezone.
- Fallback for Luma: `northbell/luma-events-scraper` (no documented stable id; our adapter would fall back to a hash of url+start) or `lexis-solutions/lu-ma-scraper` (stable `api_id` but 16x the price; field mapping not yet written).

Caveats: low usage on the Luma Actors; Luma has no Berkeley city page, so we fetch the SF Bay Area page and keep only events whose venue coordinates fall inside the configured Berkeley launch areas (online events and hidden addresses are dropped). Topic tags are never inferred from text: each request is one allowlisted topic (as keyword), and results carry that topic. Output field names for tortuga/filip come from Store pages and examples, not a live run; the first approved run should be inspected (`rejected` reasons in the report) and the field readers in `src/server/discovery/normalize.ts` adjusted.

## Spend approval needed

Not run. Estimated cost of the following is under $0.05 (24 items, 2 topics). Owner approval required, then:

```
APIFY_API_TOKEN=... APIFY_ACTOR_ID=tortuga/luma-scraper APIFY_ACTOR_BUILD=REPLACE_WITH_REVIEWED_BUILD_ID APIFY_SOURCE=luma \
APIFY_MAX_ITEMS=24 APIFY_TOPICS=board-games,live-music APIFY_WINDOW_DAYS=14 \
node --experimental-strip-types scripts/ingest-catalogue.ts --fetch
```

Replace `REPLACE_WITH_REVIEWED_BUILD_ID` with the exact build ID/tag checked in the Actor's Apify page; the adapter rejects a missing build and never follows `latest`. Add `--commit <database>` only after reviewing the printed report (default prints the normalized events and commits nothing). For Meetup use `APIFY_ACTOR_ID=filip_cicvarek/meetup-scraper APIFY_SOURCE=meetup` and independently pin its reviewed build. The command above is documentation only; no Actor run or spend is authorized by this document.

## Adapter (src/server/discovery)

- `config.ts`: fixed config from env; fails closed (missing token, Actor, pinned build, unreviewed Actor/source pair, `maxItems` > 50, timeout > 120 s, unknown topic). One retry maximum.
- `apify.ts`: `fetchCatalogue(config, token, fetchImpl)`; no user data in the signature; each request passes `guardPublicCatalogueQuery`; AbortSignal timeout; results truncated to the cap even if the Actor over-delivers; token only in the Authorization header.
- `normalize.ts`: reads an allowlist of public fields only; drops hosts/guests/organizers/descriptions; instruction-like or markup titles rejected, control characters stripped; local times converted to UTC via IANA zone; area from venue coordinates; `safeCatalogueUrl` on a per-source host allowlist; dedupe by stable source id (fallback hash of url+start).
- `cache.ts`: in-memory, keyed by source/actor/pinned build/region/window/topics/cap, 6 h TTL, concurrent callers share one in-flight request.
- `index.ts`: `loadCatalogue(env)` = config, cache, fetch, normalize, provenance (source host, actor, pinned build, fetchedAt).
- `server-only` is not installed; the folder is only imported by `scripts/ingest-catalogue.ts` and must not be imported from client components. The CLI also keeps a 6 h file stamp and lock in `.cache/catalogue`, so separate processes do not re-fetch.

## First live run and area fix (2026-10-25)

First approved run: `tortuga/luma-scraper` build `0.1.6`, 2 topics × 12 items, $0.0128. The Actor worked, but 0 of 24 events were kept: Luma's `sf` page is mostly San Francisco, and only the two `berkeley-*` boxes were accepted (a Telegraph venue at 37.8597 was also just south of the campus box). Fix: Luma results may match every launch area (Meetup still stays around Berkeley), the campus box reaches Dwight Way, and `sf-soma` covers SoMa and the Financial District. Replaying the same stored datasets keeps 7 of 24 (6 `sf-soma`, 1 `berkeley-campus`); the rest have no public venue, fall outside every area, or start after the 14-day window. Known quality gap: the Actor's keyword search is fuzzy, so a topic tag can be wrong (e.g. "Ping Pong Night" under `board-games`). **Owner step:** add `sf-soma` to the module's `areas` allowlist (`node scripts/discovery-config.ts dor` prints the call), or `sf-soma` events are refused at upsert.
