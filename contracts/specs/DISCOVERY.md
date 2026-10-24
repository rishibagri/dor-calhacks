# C8 proposal — discovery publication, approximate area and event intention

**Status: proposed shared contract, no executable schema in this reset.** Product choices are confirmed; exact shapes/defaults need CS/DS/AI/Cyber review. Preserve C1–C6 and D028 guards unchanged. Do not import ad hoc proposed shapes into production.

## Producers and consumers
CS produces publication/area/invitation UI and module integration; Cyber owns guards and consent records; DS consumes authorized projections for matching; AI consumes bounded options and returns untrusted proposals. Every reviewed shape belongs in `@kinetic/contracts`, with generated schemas, fixtures and versioned rejection tests.

## Proposed records (names are design vocabulary, not exports)
| Record | Minimum meaning | Visibility and guard |
|---|---|---|
| DiscoveryPublication | Owner, selected public name/avatar/tags, audience, purpose, notice/profile version, approved revision, expiry and withdrawn state | Owner writes their own exact preview; viewers see only approved projection while publication/area/block rules hold |
| AreaParticipation | Owner, coarse area key, captured-at, expiry and active status | Private server eligibility; no raw lat/lon, distance or exact capture time in peer projection; one-time explicitly renewed |
| EventIntent | Owner, canonical C7 event ID, interested/going enum, audience, publication version, expiry, revoke state | Explicit per-event publish; no inference from scraping or private calendar; event end caps expiry |
| DiscoveryCard | Opaque reference plus approved public profile fields and safe overlap reason codes | Caller-filtered projection; no pair policy, private support mode, routine, contact detail or journal link |
| IntroductionProposal | Participants, source publication/intent versions, allowed reason codes, optional event ID, revision, expiry | Worker-only proposal; current both-sided eligibility/block and source checks at commit |
| IntroductionRequest | Sender, recipient, proposal revision, own action and expiry | Human-triggered request; authenticated sender; recipient alone accepts/declines; nonparticipants cannot observe |
| DiscoveryBlock / Report | Reporter/blocker, target, coarse reason code, timestamp | Private moderation/owner state; block both matching directions immediately; never expose report details to target |

Bound lengths, arrays and allowed tag sets; reject unknown nested fields and sensitive/free-text payloads. Avatar support requires a bounded approved media path, not arbitrary server URL fetch. Exact TTLs, area resolution and publication audience must be captured in the reviewed schema/guard change.

## Three separate consent operations
1. Publication permits the named fields to the displayed discovery audience; no pair relationship is required for public-profile preview. This is the intentional exception to pair-only **support** disclosure.
2. Introduction request/acceptance permits an in-app connection action. It does not grant private context, external contact details, arbitrary messages or future support nudges.
3. C2/C3/C7 pair sharing remains named and separately approved after a relationship is accepted. Do not automatically assign a friend preset or enable categories.

For new event plans, C8 establishes discovery eligibility; C7 governs a versioned shared plan with independent human acceptance. Do not overload ApprovedSignal v2 or reuse pair consent for a discovery audience.

## Proposed authoritative transitions
Publish/update/withdraw profile; activate/expire area; publish/revoke event intent; create/cancel introduction proposal; send/accept/decline invitation; block/report. These are logical transitions, not existing reducer names.

Each transition validates authenticated actor, own-action authority, expected revision, current audience/consent, expiry, mutual block state, input allowlists, idempotency and applicable rate/cooldown limits. Publication changes invalidate dependent proposals. Replay never restores revoked state. At finalization, both participants must have accepted the same still-current plan revision. Individual acceptance/decline reasons remain private until a shared confirmed outcome is authorized.

## Retrieval and agent exchange
Filter in authoritative state before ranking: active profile + permitted area + no block + allowed audience + current event intent when required. Use indexed access and bounded pagination, no global user dump. Agent work starts only after deterministic shortlist; cache keys include publication/consent versions and expire with their sources. Cached permission is never sufficient for final delivery.

Agent prompts contain approved tags/options, not public bios copied wholesale or private history. Models can select a permitted option or decline, at most two rounds. Unknown/unsafe output produces no introduction. Both “no eligible candidates” and “user chose not to publish” are valid outcomes. Public profile visibility precedes invitation acceptance by user choice.

## Acceptance and rollout
Add direct reducer/view tests for audience, block, expired area, withdrawal during generation, stale retry, changed intent, wrong revision, invitation spam and cross-account reads. Clock-based expiry must work on live views, not just worker checks. Publish synthetic fixtures for a newcomer, same-event pair, existing friend, empty area and privacy attack. Require affected owner ACKs before feature flag rollout. Documentation does not establish these protections exist.
