# More Apify sources for the window: events and places (proposal)

Status: **proposal, researched only.** Prices, inputs and output fields come from each Actor's Apify Store listing and its pinned build's schema, read on 2026-10-25 with the API (free reads). None of these Actors has been run; nothing here is implemented beyond what [APIFY_SOURCE.md](APIFY_SOURCE.md) describes. Owner: CS (Rishi) for ingestion; Cyber reviews any new source or table; DS owns ranking.

## Goal

The window shows real things to do nearby. Today that is Luma events only (one live event on Maincloud after the area fix). Two additions would make it useful for someone new: **more events** and **places worth going**, such as well-reviewed places to eat. Discovery stays zero-model: sources are developer-configured, inputs never contain user data (D028), and ranking is deterministic.

## Candidates

| Source (Actor, pinned build) | Use | Price (pay per result) | Location in output | Personal data in output | Fits today's pipeline? | Recommendation |
|---|---|---|---|---|---|---|
| **Luma**: `tortuga/luma-scraper` `0.1.6` | events | $0.0005/event | venue lat/lon | host names (dropped) | yes (live) | keep |
| **Meetup**: `filip_cicvarek/meetup-scraper` | events | ≈$0.0005/event + start | venue lat/lon | organizer names (dropped) | yes (approved, not run) | run next; Berkeley-centred |
| **Google Events**: `johnvc/google-events-api---access-google-events-data` `0.0.304` | events from Google's events panel (any host site) | $0.0125/run + ≈$0.00001/item | **address text only** (`location` is an input string) | none expected (public listings) | events table yes; **area rule no** | yes, after an address → area rule |
| **Google Maps**: `compass/crawler-google-places` `0.14.775` | places: restaurants, cafés, study spots | $0.004/place (+$0.001 per filter) | lat/lng | reviewer names and texts only if review scraping is on (keep it off) | **no**: places have no start time | yes, with a new `catalogue_place` table |
| **Google Search**: `apify/google-search-scraper` `0.0.468` | find event pages | $0.0045/results page | none (organic links) | none | no: unstructured results | not for the window; maybe source discovery later |
| **Instagram hashtags**: `apify/instagram-hashtag-scraper` `0.0.707` | trending local posts | $0.0026/post | `locationName` text only | **yes**: `ownerUsername`, `ownerFullName`, `mentions`, `taggedUsers`, comments, captions | no | **do not ingest** (see below) |

Rough cost for a refresh every 6 hours over the launch areas: Google Maps at 20 places × 2 categories ≈ $0.18; Google Events at 2 queries ≈ $0.03; Luma and Meetup at 24 items each ≈ $0.03. That's about $0.25 per refresh, or roughly $1 per day at four refreshes.

## How each would plug in

### Google Events → `catalogue_event` (no schema change)
- Input: fixed `q` per allowlisted topic (for example "live music events"), `location: "Berkeley, California"` or `"San Francisco, California"`, and `max_pages: 1`. Never user text or device location.
- Output events carry title, date text, an address array, a link and a venue name. There are **no coordinates**, so `areaForVenue` would drop every one, as happened with Luma before the area fix.
- Needed: a reviewed **address → area** rule (a ZIP or city/neighbourhood allowlist per launch area, applied on the server at ingest). Times are text such as "Sat, Nov 1, 8 – 11 PM", so they need a parser with the venue's IANA zone; an event with an unparseable time is dropped, never guessed.
- Links point at many hosts, so `source_url` keeps only allowlisted hosts (D039). Any other link becomes `null`, and the flyer has no "Open listing".

### Google Maps → new `catalogue_place` (additive module change)
- A public, ingester-written table and view, mirroring `catalogue_event`: `{place_id, name, category, rating, review_count, price_level?, area_key, source_url (maps.google.com only), fetched_at}`. **Never** review text, reviewer names, phone, email or social profiles: keep `maxReviews: 0` and `scrapeContacts: false`, and add a normalizer allowlist like `normalize.ts`.
- Input: allowlisted category queries ("restaurants", "cafes", "boba", "study cafe") with a `locationQuery` per launch area, `placeMinimumStars: 4`, `skipClosedPlaces: true`, and a cap per search.
- Window: places appear as flyers with a "places" stamp ("4.6 ★ · 1.2k reviews · Telegraph"). They're ranked by rating × log(review count) inside the viewer's area (DS, zero-model). "Show my interest" stays events-only until a place-intent design is reviewed.
- Steps: contract in `@dor/contracts` (C7 catalogue), module table + reducer + view, Cyber review, Nimisha republishes (additive, like D045), then bindings, adapter, ingest and the window.

### Google Search (not for the window)
Organic results are pages, not events or places. They could later help find new event *sources* for the team to review, never as items shown to users.

### Instagram (do not ingest)
Hashtag results are posts by individuals. The dataset includes usernames, full names, mentions, tagged users, comments and free-text captions. Ingesting them would put identifiable people's content into dor and contradict the README ("generic, developer-configured public event catalogue"). Turning a caption into an event would also need text inference, which D028 rules out for topics. If venue accounts matter later, the safe version is: a reviewed allowlist of **business** profiles, keeping only the post link and timestamp, after Cyber review.

## Open decisions
1. Approve the `catalogue_place` table (CS + Cyber), then owner republish (Nimisha).
2. Approve the address → area rule for Google Events (DS + Cyber).
3. Spend: one capped exploratory run per approved Actor (≈$0.05 each) to confirm the output fields before writing the adapters.
