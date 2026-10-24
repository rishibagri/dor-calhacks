# Nearby people and event-based connections

Status: **user-approved product scope; proposed implementation boundary, not a live feature.** R0–R6 in README supersede the old phase schedule. C8 is proposed; current C3 and D028 runtime constraints remain unchanged until a reviewed schema/guard change lands.

## Confirmed choices
- One-time approximate location. No continuous GPS or passive tracking.
- Show opted-in public profiles first, before an invitation is accepted.
- Retain private reflection and existing partner/friend/family flows.
- Broaden the purpose to human connections generally, including newcomers and local events.

## Product flow
1. User enters Discover without having to write a journal. Quiz remains optional and local.
2. Preview a discovery profile: chosen display name, optional avatar and explicitly selected nonsensitive interest tags. Publication is separate from account creation and journal consent. Show the audience and duration before confirming.
3. Ask for location once, on deliberate user action. The browser may return a precise sample even when high accuracy is disabled. Quantize on device into a coarse area, discard the sample, and send only the agreed area key. Do not put coordinates in logs, URLs, analytics or storage. On denial, allow manual broad-area selection or public-event browsing without discovery.
4. Match active opted-in profiles through a bounded, authenticated, caller-filtered query. Profiles can be shown before mutual acceptance. UI says “in your selected area,” never “currently 100 feet away.” An older location snapshot is not live presence.
5. Deterministic filters/ranking find overlap. Agents can compare the permitted cards in a bounded exchange and suggest a concrete opening using approved fields. Example: “You both selected board games; this public games night could be a good first activity.”
6. User deliberately sends an in-app introduction request. Recipient can accept, ignore or decline; no automatic message impersonating either person. Do not expose private decline/quiet-hours reasons. Existing support-sharing rules remain off until separately configured.
7. For events, users separately publish an event intention. A listing from Apify never implies an attendee list or private attendance data. A shared plan needs both people to accept the same revision while all permissions remain current.
8. Withdraw/block/report controls are available before contact. Withdrawal removes future authorized discovery and suppresses pending derived suggestions; previously viewed public information cannot be recalled.

## Proposed defaults for owner review
These are engineering proposals, not user-confirmed values or implemented settings.

| Control | Initial proposal | Why / acceptance condition |
|---|---|---|
| Audience | Eligible signed-in, opted-in discoverers in the same broad launch area | Clear audience preview; no unauthenticated directory or raw public-table access |
| Coarseness | Neighborhood/campus-scale area; floor approximately 1 km, widen for sparse settings | Avoid block-level/distance inference; exact grid resolution requires Cyber/DS review and edge-case tests |
| Area participation | Expires after 24 hours, renewed only by explicit user action | No background location refresh; expired area cannot imply current presence |
| Profile exposure | Active only with current publication consent AND valid area participation | Publishing is deliberate; turning discovery off invalidates use immediately |
| Candidate work | Retrieve at most 50 authorized candidates per pass; rank to top 3 | Initial caps to benchmark, not measured capacity; no all-pairs agent conversations |
| Notification | At most one discovery nudge/day initially, with mute/quiet hours | Separate purpose from existing pair cooldown; proposals require consent and no fit means silence |
| Event intent | Per-event explicit publish, expires no later than event end or chosen shorter expiry | “Interested” / “planning to go” only; no verified-attendance claim |
| Launch | One configured region with synthetic opt-in accounts for testing | Real profile density must be demonstrated; never label synthetic users as actual neighbors |

TTL alone does not enforce expiration in SpacetimeDB views without a clock. Cyber must design scheduled invalidation and an authoritative read/delivery gate that prevents stale exposure; a client countdown alone is insufficient. Test the stale-record window and document actual semantics.

## Shared places, without surveillance
Support only deliberate public venue/topic choices after a reviewed allowlist and explicit publication preview. Never derive habitual visits from location, journal text, calendar history or scraping. No home, work, healthcare, religious or other sensitive routine inference. The initial release can match venue categories/interests and event venues; exact favorite-place tags can wait if safe semantics are not ready. “Both selected this venue” is different from “both go here every Tuesday.”

## Data and provider boundaries
- Journal text/audio/private reflections and raw quiz answers remain private. They are never discovery ranking inputs on the shared worker.
- Shared discovery may use only explicitly published tags/intents and authorized coarse eligibility. Profile identity can be visible to the human; agent prompts should receive the minimal tags/options and opaque references, with public names resolved only for display when allowed.
- Existing D028 Apify inputs reject location. Preserve that guard. Use a developer-configured city/campus source/feed common to users, with allowed generic topics; geographic source configuration needs explicit Cyber review. Do not encode device-derived cells as a topic/locale or user search.
- Matching happens inside dor. No profile, relationship, account/pair ID, attendance intention or private preference is sent to Apify.
- Public event venue addresses may appear as source-backed event information; a person's location never becomes an event address field.
- Source content is inert untrusted data. Sanitize text/URLs, cap size, dedupe, keep provenance and never grant tools to scraped instructions.

## Ownership and meaningful acceptance
CS: area/profile/invitation wiring, indexed state and public source/cache. Nimisha: shortlist, relevance/evaluation and discovery result component. Adam: bounded introduction/event workflow and worker adapters. Sumedh: publication/expiry/block/abuse/consent enforcement and privacy controls.

Required tests: not opted in, unauthenticated viewer, stale publication/area, profile edited during generation, block in either direction, repeated profile probing, invitation flood, wrong recipient/revision, expired event, forged attendee claim, empty region, one-sided event intent, duplicate events, sparse area and cell edges. Verify direct subscriptions and reducer calls, not just hidden buttons. Keep public-profile publication separate from acceptance of an introduction and from pair support consent.
