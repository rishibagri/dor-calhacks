# More Apify sources for the window: events and places (proposal)

Status: **Google Maps places and Google Events implemented on `feat/window-places` (D051 proposal); offline-tested and run live against Apify; NOT yet on Maincloud** (places need the owner republish below). Google Search and Instagram stay unimplemented as recommended. Product direction from Adam (2026-10-25): build places without a separate Cyber review; the guard, tests and field allowlists below are the safeguards.

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

## Implemented (D051 proposal, 2026-10-25)

- **Contract:** `guardCataloguePlace` (`contracts/src/places-policy.ts`, re-exported from `@dor/contracts/policy`) is default-deny. It accepts only `{placeId, name, kind, label, ratingTenths, reviewCount, areaKey, sourceUrl, fetchedAtMs}`; kinds are `food | coffee | dessert | study`; text is cleaned; the area must be allowlisted; links pass `safeCatalogueUrl`.
- **Module:** private table `catalogue_place`; ingester-only `upsert_catalogue_place` (owner or allow-listed worker; never rolls back to an older fetch); public view `catalogue_places` (registered accounts, discovery on, at most 200 rows). The upgrade adds only these (37/53/32 → 38/54/33), rehearsed locally from Maincloud's `f89d0bf`. Module tests: `spacetimedb/tests/places.test.ts`.
- **Adapters:** `src/server/discovery/google.ts`, on pinned builds `compass~crawler-google-places` `0.14.775` and `johnvc~google-events-api…` `0.0.304`.
  - Places: one query per kind × launch area ("restaurants Telegraph Avenue near UC Berkeley"); the area comes from the place's coordinates. A place needs a rating of at least 4.0 and at least 30 reviews; closed places are dropped. Only the allowlisted fields are read: no reviews, reviewer names, phone, website, hours or coordinates are stored.
  - Events: one query per topic × city ("live music events in Berkeley"). **Address rule:** a ZIP when present (94720/94704 campus; 94709/94710/94702/94703 downtown Berkeley; 94110 Mission; 94102–94111/94158 SoMa), otherwise the city (Berkeley → `berkeley-downtown`, San Francisco → `sf-soma`); anything else is dropped. Times like "Oct 29, 7:00 PM" are read as Bay Area local time; an entry without a clock time is dropped, never guessed.
- **Ingest:** `node --env-file=.env.local --experimental-strip-types scripts/ingest-catalogue.ts --google [--kinds food,coffee,dessert] [--topics …] [--max 20] [--commit dor --server maincloud --cli-config <worker cli.toml>]`. Three Actor runs at a time (the account allows 5 jobs / 16 GB). Each fetch saves `.cache/catalogue/google-latest.json`; `--from-cache` commits that same data without paying again.
- **Window (live app):** four flyers, two events and two places when both exist. Places come from the viewer's area first, ranked by rating × log10(10 + reviews). A place flyer shows "★ 4.6 · 812 reviews" and its Google category, and "Open listing" opens its Google Maps page. "Show my interest" stays events-only.

### First live runs (2026-10-25)
- 12 Google Maps jobs (food, coffee, dessert × 4 areas, 20 each): **170 places kept** of 240. The rest were outside the area boxes or had too few or low reviews.
- 14 Google Events jobs (7 topics × 2 cities): **44 events kept**. Some Berkeley queries returned nothing; the rest were dropped for the 14-day window, region or a missing time.
- Spend so far: about $1.10 across all Apify runs this month (account limit $205).

### Owner steps (Nimisha), in order
1. Republish from the merged branch (additive; never `--delete-data`): `spacetime publish -s maincloud --module-path spacetimedb -y dor`. Expect `Created user table: catalogue_place` and `Created view: catalogue_places` only.
2. Allowlists:
   `spacetime call -s maincloud dor set_discovery_config '"areas"' '["berkeley-campus","berkeley-downtown","sf-mission","sf-soma"]'`
   `spacetime call -s maincloud dor set_discovery_config '"source_hosts"' '["eventbrite.com","meetup.com","lu.ma","luma.com","google.com"]'`
3. Check: `spacetime sql -s maincloud dor "SELECT * FROM discovery_config"` and `spacetime logs -s maincloud dor -n 30`.
