# Activity discovery and shared plans — CS-owned

## Decision and scope
The user assigned Apify discovery to CS (you), not a separate personal workstream. Nimisha supplies matching; Adam supplies bounded agent coordination; Sumedh owns disclosure rules. The product aims to turn approved interests and compatible availability into something two people choose to do together. It complements a call by helping people find a reason and a moment to connect.

This is approved implementation scope, not a live integration. D028 input/link guards are now implemented; no Actor/source has been selected or run by this documentation update. The reset prioritizes one public local-event catalogue in a developer-configured launch region, while retaining online activities for existing long-distance connections. Nearby and same-event people matching use the separate C8 publication/intent rules. No booking, payment, automatic personal messages or group matching in this increment.

## End-to-end responsibilities
1. **CS:** select and validate one Apify Actor/source; collect a broad public catalogue server-side without user context. Pin a tested build where supported; store source/run metadata and fetch time. Normalize, sanitize, deduplicate, cache and expose safe catalogue fields.
2. **Nimisha:** define relevance criteria and deterministic matching over approved activity interests, format, duration and availability. A locally selected interest stays local unless the owner explicitly approves the new disclosure category. Do not pass private quiz extras to the shared worker.
3. **Sumedh:** review the activity/proposal schema and new preset categories, preview, exact approval and expiry. Current C3 only supports support preference/coarse availability and MUST NOT be overloaded with activity IDs or free text.
4. **Adam:** consume normalized catalogue items and approved context in a bounded proposal/counterproposal workflow. Treat scraped text as data, never tool instructions.
5. **CS:** display a named-recipient plan proposal and each person's independent accept/decline state through guarded SpacetimeDB transitions. Finalize only when both accept the same proposal revision; cancellation, changed consent or expired source suppresses stale proposals.

## Proposed catalogue boundary (C7; not yet executable)
Public activity record: stable activity ID; allowlisted HTTPS source URL; title; bounded plain-text summary; activity format (online/in-person); categories; start/end/timezone if verified; duration if known; source site; Actor/build/run reference stored server-side; fetchedAt; freshness status. Missing price, dates or availability are unknown, never invented. Ticket availability and price are observations at fetch time, not guarantees. Do not attach user/pair/journal IDs to catalogue rows or Apify jobs.

Private user interests, person-specific search text, exact calendar slots, relationship type, quiz answers and journal content are absent from Apify inputs. Collect a generic catalogue first; match inside dor. D028 rejects location in runtime queries. Use a developer-configured regional source/feed common to users and review that configuration with Cyber; never derive Actor inputs from device location or preferences. User-derived location export would need a separate reviewed contract/processing choice. Public event venues may have source-backed addresses; personal exact location stays outside scope.

## Integration contract work before shared activity delivery
- CS proposes `ActivityCatalogueItem`, source query/results and `ActivityProposal` shape with Nimisha/Adam/Sumedh as consumers.
- Sumedh proposes explicit activity-interest/detail consent categories plus current preset/assignment/item-version rules. Do not add unreviewed fields to ApprovedSignal v2 or pretend current presets permit activity sharing.
- CS/Adam specify proposal revision, two independent acceptances, no-action/expired/cancelled state, work idempotency and atomic result commit.
- Each change lands in the shared contract package with source schemas, generated schemas, fixtures and checks. C7 in this document is an interface plan only until that PR is reviewed; it is not a currently exported runtime type.

## CS implementation phases — current R schedule
| Phase | Deliverable | Exit evidence |
|---|---|---|
| CS-R0/R1 | One source/Actor selected; input/output/build, limits and price model documented | A real sample or explicit fixture is labeled; Actor fit and cost confirmed |
| CS-R3 | Server adapter, normalization, bounded run/poll, dedupe/cache and read-only catalogue | Valid source-backed records; timeout/rate-limit/empty/malformed handling tested |
| CS-R3/R4 | Catalogue cards and safe matching integration fixtures | Source links, format, freshness and unknown values displayed accurately |
| CS-R3 | Approved shared-plan contracts and both-person acceptance | Two accounts accept same current revision; revoke/expiry blocks finalization |
| CS-R5/R6 | Stable source configuration, fallback and release evidence | Core app works when source fails; cached results clearly labeled |

## Operational boundary
Use a server/worker-only APIFY_API_TOKEN and Authorization header; never NEXT_PUBLIC or a logged token query string. Actor selection, build and source domains are configured by developers, never arbitrary model-supplied URLs. Bound timeout, retries, item count, refresh frequency and cost for the chosen Actor before live jobs. Long-running collection uses asynchronous run status/dataset retrieval or a verified completion handler, not an indefinitely blocked browser request. Validate callback authenticity if webhooks are used. Do not run a new paid Actor for every UI refresh.

Cached last-successful records can be used only with age/status visible. If no verified record exists, show unavailable or explicitly synthetic data; do not fabricate live events. Sanitize markup, cap result size, reject unsafe URL schemes and prevent SSRF if any server fetch is added. Public metadata must still follow source usage requirements; choose a supported Actor/source with the Apify team.

## Acceptance
One tested source; source provenance and freshness; no private inputs to Apify; bounded resource use; empty/timeout/malformed/duplicate/expired cases; wrong-recipient/stale-proposal rejection; both-person acceptance; no automatic external action. User-specific suggestions remain blocked until consent contracts are reviewed and real authorization is wired.

## Questions for Apify
Which reliable Actor fits public local events for the configured launch region, with online events retained where useful? What are the exact input/output schema, tested build and price model? Should we batch refresh or search on demand? How should we retrieve status/dataset and handle partial results? What usage credits and judging requirements apply? Could they review one implemented integration?

Sources: [API integration](https://docs.apify.com/integrations/api), [Actor runs/builds](https://docs.apify.com/actors/running/runs-and-builds), [API reference](https://docs.apify.com/api/v2).

## Event-based human connections (reset)
An event listing is public catalogue data, not a list of attendees. Under C8, a user explicitly publishes interested/going intent with audience and expiry. DS matches compatible approved intentions and AI may suggest a bounded introduction; users choose the invitation and shared plan. Show opted-in profiles before invitation acceptance. Revoking an intent, withdrawing a profile, blocking a user or expiring an event suppresses dependent suggestions. A connection formed this way inherits no partner/friend/family support consent. See LOCAL_CONNECTIONS.md and contracts/specs/DISCOVERY.md.

Cache by configured source/build/region/time window, not user. Normalize each source record once, cap items/polls/retries and deduplicate concurrent refreshes. Serve last successful data only with age and freshness policy; never launch a paid Actor per page render. Actual limits/costs must be selected for the chosen Actor before the morning live run.
