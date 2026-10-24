# Activity discovery and shared plans — CS-owned

## Decision and scope
The user assigned Apify discovery to CS (you), not a separate personal workstream. Nimisha supplies matching; Adam supplies bounded agent coordination; Sumedh owns disclosure rules. The product aims to turn approved interests and compatible availability into something two people choose to do together. It complements a call by helping people find a reason and a moment to connect.

This is approved implementation scope, not an implemented integration. No Actor has been selected or run by this documentation update. Start with one public catalogue of online activities/events suitable for people in different places. Add visit/local activities only after the first source works. No booking, payment, automatic personal messages or group matching in this increment.

## End-to-end responsibilities
1. **CS:** select and validate one Apify Actor/source; collect a broad public catalogue server-side without user context. Pin a tested build where supported; store source/run metadata and fetch time. Normalize, sanitize, deduplicate, cache and expose safe catalogue fields.
2. **Nimisha:** define relevance criteria and deterministic matching over approved activity interests, format, duration and availability. A locally selected interest stays local unless the owner explicitly approves the new disclosure category. Do not pass private quiz extras to the shared worker.
3. **Sumedh:** review the activity/proposal schema and new preset categories, preview, exact approval and expiry. Current C3 only supports support preference/coarse availability and MUST NOT be overloaded with activity IDs or free text.
4. **Adam:** consume normalized catalogue items and approved context in a bounded proposal/counterproposal workflow. Treat scraped text as data, never tool instructions.
5. **CS:** display a named-recipient plan proposal and each person's independent accept/decline state through guarded SpacetimeDB transitions. Finalize only when both accept the same proposal revision; cancellation, changed consent or expired source suppresses stale proposals.

## Proposed catalogue boundary (C7; not yet executable)
Public activity record: stable activity ID; allowlisted HTTPS source URL; title; bounded plain-text summary; activity format (online/in-person); categories; start/end/timezone if verified; duration if known; source site; Actor/build/run reference stored server-side; fetchedAt; freshness status. Missing price, dates or availability are unknown, never invented. Ticket availability and price are observations at fetch time, not guarantees. Do not attach user/pair/journal IDs to catalogue rows or Apify jobs.

Private user interests, person-specific search text, exact calendar slots, relationship type, quiz answers and journal content are absent from Apify inputs. Collect a generic catalogue first; match inside Kinetic. If future searches require city/preferences, introduce an explicit provider-processing choice first. Exact addresses and live location are outside current scope.

## Integration contract work before shared activity delivery
- CS proposes `ActivityCatalogueItem`, source query/results and `ActivityProposal` shape with Nimisha/Adam/Sumedh as consumers.
- Sumedh proposes explicit activity-interest/detail consent categories plus current preset/assignment/item-version rules. Do not add unreviewed fields to ApprovedSignal v2 or pretend current presets permit activity sharing.
- CS/Adam specify proposal revision, two independent acceptances, no-action/expired/cancelled state, work idempotency and atomic result commit.
- Each change lands in the shared contract package with source schemas, generated schemas, fixtures and checks. C7 in this document is an interface plan only until that PR is reviewed; it is not a currently exported runtime type.

## CS implementation phases
| Phase | Deliverable | Exit evidence |
|---|---|---|
| CS-P0/P1 | One source/Actor selected; input/output/build, limits and price model documented | A real sample or explicit fixture is labeled; Actor fit and cost confirmed |
| CS-P2/P3 | Server adapter, normalization, bounded run/poll, dedupe/cache and read-only catalogue | Valid source-backed records; timeout/rate-limit/empty/malformed handling tested |
| CS-P4/P5 | Catalogue cards and safe matching integration fixtures | Source links, format, freshness and unknown values displayed accurately |
| CS-P6 | Approved shared-plan contracts and both-person acceptance | Two accounts accept same current revision; revoke/expiry blocks finalization |
| CS-P7–P9 | Stable source configuration, fallback and release evidence | Core app works when source fails; cached results clearly labeled |

## Operational boundary
Use a server/worker-only APIFY_API_TOKEN and Authorization header; never NEXT_PUBLIC or a logged token query string. Actor selection, build and source domains are configured by developers, never arbitrary model-supplied URLs. Bound timeout, retries, item count, refresh frequency and cost for the chosen Actor before live jobs. Long-running collection uses asynchronous run status/dataset retrieval or a verified completion handler, not an indefinitely blocked browser request. Validate callback authenticity if webhooks are used. Do not run a new paid Actor for every UI refresh.

Cached last-successful records can be used only with age/status visible. If no verified record exists, show unavailable or explicitly synthetic data; do not fabricate live events. Sanitize markup, cap result size, reject unsafe URL schemes and prevent SSRF if any server fetch is added. Public metadata must still follow source usage requirements; choose a supported Actor/source with the Apify team.

## Acceptance
One tested source; source provenance and freshness; no private inputs to Apify; bounded resource use; empty/timeout/malformed/duplicate/expired cases; wrong-recipient/stale-proposal rejection; both-person acceptance; no automatic external action. User-specific suggestions remain blocked until consent contracts are reviewed and real authorization is wired.

## Questions for Apify
Which reliable Actor fits online events/activities? What are the exact input/output schema, tested build and price model? Should we batch refresh or search on demand? How should we retrieve status/dataset and handle partial results? What usage credits and judging requirements apply? Could they review one implemented integration?

Sources: [API integration](https://docs.apify.com/integrations/api), [Actor runs/builds](https://docs.apify.com/actors/running/runs-and-builds), [API reference](https://docs.apify.com/api/v2).
