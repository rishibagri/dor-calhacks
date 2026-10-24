# CS — you — revised implementation plan

**Branch:** `role/cs-app`. **Baseline:** main `d7285eb`. **Task IDs:** `CS-R0` through `CS-R6`.

## Your outcome and owned files

Application composition, identity, SpacetimeDB publishing/bindings, Apify ingestion and deployment.

**Owned implementation:** src/app/ and shared shell; src/lib/backend/, src/lib/identity/, src/lib/spacetime/; spacetimedb module exports/schema integration; src/server/discovery/. New `src/features/` folders are assignments, not shipped components. Claim exact files in your own update log before editing shared surfaces.

## Already implemented — preserve it

Pages, quiz and database adapter are implemented. The app composition root still selects placeholderVault and placeholderReflection. Bindings are placeholders. Cyber has now shipped the real vault, guarded approval, delivery and commit reducers; integrate those rather than reimplementing them.

## Product reset

dor now supports existing relationships, nearby introductions and meeting people through local events. Use one-time approximate location and explicitly published public profiles visible before an invitation is accepted. No journal is required for discovery. Existing support signals/presets never grant stranger access. Read [LOCAL_CONNECTIONS](../features/LOCAL_CONNECTIONS.md), [C8 discovery](../../contracts/specs/DISCOVERY.md) and [README](../../README.md).

R phases replace old P scheduling only. Keep old commit-specific handoff history. Use the actual time remaining in the original 36-hour sprint; percentages are estimates, not a reset of the clock. Each person owns code, tests and a usable feature component so CS is not the sole implementer.

## CS-R0 · Reconcile the latest build and freeze the new seams

**Shared allocation:** 3% of remaining time, at most 30 minutes.

**Implement:** Merge current main into your existing role branch. ACK the provider-route claims and vault/guard integration seams. Inventory placeholder bindings and environment needs. Select one preconfigured launch area and one public event source with Apify; do not start a paid run for planning.

**Your exit evidence:** One ownership map, one source configuration proposal and exact shared binding paths.

**Next consumer:** All: module/config seam; Nimisha: catalogue sample; Sumedh: C7/C8 schema proposal.

**Shared gate:** Every missing interface has a producer, consumer and file claim. No one repeats completed bootstrap work.

**When blocked:** If a shared schema is unresolved, continue UI/rank/adapter work on explicitly synthetic fixtures; shared delivery remains disabled.

## CS-R1 · Finish the existing connection path and implement new discovery contracts

**Shared allocation:** 18% of remaining time.

**Implement:** Wire per-account LocalVault and lifecycle subscription, widen ReflectionPort to PrivateReflection and compose Adam/Sumedh feature components. Generate actual module bindings and configure verified account/worker identities. Publish C7/C8 canonical schema changes with affected owners; apply D027 Q2 copy.

**Your exit evidence:** Typed journal save/unlock and device-only preview work; generated bindings are reproducible, or live prerequisite blocker is named.

**Next consumer:** Adam: generated reducer/view bindings; Sumedh: vault integration; Nimisha: reviewed C7/C8 exports.

**Shared gate:** Existing typed reflection-to-nudge flow has all real adapter implementations; C7/C8 schema, fixtures and guards are reviewed before shared discovery is enabled.

**When blocked:** Credentials can defer live execution, not implementation of identity/consent checks. Keep all data synthetic until the real boundary passes.

## CS-R2 · Ship the nearby introduction vertical slice

**Shared allocation:** 22% of remaining time.

**Implement:** Implement explicit one-time location capture, on-device coarsening and immediate coordinate discard. Add area/profile setup and thin Discover page composition. Wire indexed area/topic candidate queries, profile publication and invite/accept reducers to caller-filtered subscriptions.

**Your exit evidence:** No precise coordinate in network/storage/logs; only opted-in profiles appear; two accounts can create an accepted introduction.

**Next consumer:** Nimisha: authorized candidate page + cursor; Adam: change-trigger/job and profile versions; Cyber: network trace.

**Shared gate:** A newcomer sees opted-in public profiles before sending an invite, receives a concrete reason to connect, and can decline, withdraw or block. Direct interaction requires recipient acceptance.

**When blocked:** If density is low, show a truthful empty state plus public events. Never invent real nearby users or silently widen location precision.

## CS-R3 · Connect people through local events and shared plans

**Shared allocation:** 22% of remaining time.

**Implement:** Implement one Apify public catalogue using D028 guards, pinned source/build, bounded asynchronous ingestion, dedupe and shared cache. Use a developer-configured city/campus feed, never device-derived location in Actor input. Compose event pages and proposal acceptance controls.

**Your exit evidence:** One real source can yield normalized records with source URL, fetchedAt/timezone/unknown fields; stale-cache/failure states work.

**Next consumer:** Nimisha: C7 records; Adam: stable event IDs; Cyber: input/run metadata and proposal transitions.

**Shared gate:** Two users discover the same source-backed local event, explicitly choose to connect, and accept a current shared plan. Existing partner/friend/family journeys still work.

**When blocked:** If the source is unavailable, keep cached age visible or show unavailable. Synthetic events remain labeled; never claim a live Apify integration from fixtures.

## CS-R4 · Improve usefulness, efficiency and failure behavior

**Shared allocation:** 15% of remaining time.

**Implement:** Measure indexed query/read counts and subscription payloads; remove table-wide scans on hot owner/pair/area paths. Verify one shared catalogue refresh per configured region/window, single-flight refresh and source cost caps. Exercise reconnect and identity switching. Expand CI beyond contract-only checks using a supported Node runtime.

**Your exit evidence:** No Actor per page render, no full-user enumeration, no duplicate active subscriptions; numbers include dataset size and cache state.

**Next consumer:** Adam/Nimisha: latency/candidate counts; Sumedh: scoped cache/subscription invalidation.

**Shared gate:** All three experiences have useful outcomes, measured call budgets and passing current privacy gates. Known failures remain visible; targets are not reported as achievements.

**When blocked:** Cut extra feeds, animations or free-form agent negotiation first. Never cut consent checks, explicit public-profile opt-in or block/withdraw behavior.

## CS-R5 · Morning live verification and release candidate

**Shared allocation:** 12% of remaining time.

**Implement:** Configure Clerk issuer/audience and publish module/generate bindings. Deploy app and source adapter, verify two human accounts plus denied third account. Complete fresh-install and identity-change smoke checks on a fixed revision.

**Your exit evidence:** Published module, configured environment and browser flow have recorded revision/results; keys remain local/host secrets.

**Next consumer:** All: tested preview and reset steps; Adam: deployed worker identity and endpoints.

**Shared gate:** A fixed candidate revision works with actual providers and authoritative state. Each failure has a named owner; no mocked/live ambiguity.

**When blocked:** If a provider fails, typed input/no suggestion and truthful source-unavailable states remain. Do not put keys into logs or switch to production fake adapters.

## CS-R6 · Freeze, hand off and reserve recovery time

**Shared allocation:** 8% of remaining time.

**Implement:** Freeze app/schema/source configuration, verify deployment revision, write rollback/reset instructions and fix only release blockers. Keep video/presentation tasks in docs/DEMO.md.

**Your exit evidence:** Same reviewed revision runs and rollback path is known.

**Next consumer:** Team: release revision and environment map.

**Shared gate:** Code, configuration, evidence and team handoffs describe the same release. The product is ready for a controlled demonstration.

**When blocked:** Buffer is for release recovery, not another product pivot. Keep the user-requested personal analysis report local.

## Interface and review rules

Use the existing canonical schemas and ports. New C7/C8 wire shapes need affected producer/consumer review and Cyber boundary review, source exports, generated schemas, fixtures and direct rejection tests. A planning document does not authorize a new runtime disclosure. Do not import another owner's internals; expose the rank/feature boundary deliberately.

Keep journals, raw quiz extras and precise coordinates out of shared state, provider catalogue requests, agent logs and tests. Discovery can use only published profile/event fields under the separate C8 consent; pair signals retain named-recipient approval. No unrestricted agent conversation or automatic personal messages.

## Verification and handoff

Run the checks applicable to changed files plus root `npm run check`; shared/release changes require `check:all`, `ai:check` and the app build. Distinguish mock/harness checks, implemented adapters, deployment and live runs. Never represent an offline policy or seeded user as real discovery.

Append the exact task/commit/files/verification/next consumer/blocker in your role update log; refresh your handoff. Consumers ACK actual usable interfaces. Read all four logs hourly and before interface edits; raise blockers within 15 minutes. Preserve role branch work when merging main. The personal assessment requested by the user stays local; implementation evidence belongs in normal role logs.
