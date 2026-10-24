# Adam — AI — revised implementation plan

**Branch:** `role/ai-voice`. **Baseline:** main `d7285eb`. **Task IDs:** `AI-R0` through `AI-R6`.

## Your outcome and owned files

Voice/reflection experience, bounded agent workflows, worker adapters and provider efficiency.

**Owned implementation:** src/agents/, worker/; existing provider routes; proposed src/features/voice/; worker-side database adapter mapping against CS bindings. New `src/features/` folders are assignments, not shipped components. Claim exact files in your own update log before editing shared surfaces.

## Already implemented — preserve it

Authenticated routes, browser helpers, real-policy worker factory, JobLedger and cheaper Droid path are on main through PR #7. The existing app has not wired these helpers. Full worker adapters, recipient-preference consent backing and live Claude/Cartesia/browser checks remain.

## Product reset

dor now supports existing relationships, nearby introductions and meeting people through local events. Use one-time approximate location and explicitly published public profiles visible before an invitation is accepted. No journal is required for discovery. Existing support signals/presets never grant stranger access. Read [LOCAL_CONNECTIONS](../features/LOCAL_CONNECTIONS.md), [C8 discovery](../../contracts/specs/DISCOVERY.md) and [README](../../README.md).

R phases replace old P scheduling only. Keep old commit-specific handoff history. Use the actual time remaining in the original 36-hour sprint; percentages are estimates, not a reset of the clock. Each person owns code, tests and a usable feature component so CS is not the sole implementer.

## AI-R0 · Reconcile the latest build and freeze the new seams

**Shared allocation:** 3% of remaining time, at most 30 minutes.

**Implement:** Keep the Haiku/reused-directory Droid path and existing routes/browser helpers. Claim the voice feature component and worker-side adapters. Propose an aggregate deadline, concurrency cap and call budget.

**Your exit evidence:** A list of real vs fake dependencies, no new provider spend, and current exact adapter names.

**Next consumer:** CS: component/route interface; Sumedh: worker authority and preference consent requirements.

**Shared gate:** Every missing interface has a producer, consumer and file claim. No one repeats completed bootstrap work.

**When blocked:** If a shared schema is unresolved, continue UI/rank/adapter work on explicitly synthetic fixtures; shared delivery remains disabled.

## AI-R1 · Finish the existing connection path and implement new discovery contracts

**Shared allocation:** 18% of remaining time.

**Implement:** Build the voice/reflection feature component using current clients: record, stop, correction, cancel, typed fallback. Implement worker adapters for worker_signal_context, worker_delivery and commit_nudge with CS-generated bindings. Wire DS rank via reviewed shared port. Serialize the reused Droid directory or use isolated pool slots before enabling concurrent jobs.

**Your exit evidence:** No production fake; reflected text persists locally, candidate stays in memory; missing recipient consent returns no result.

**Next consumer:** CS: drop-in voice component; Cyber: exact read/commit mapping and version bindings.

**Shared gate:** Existing typed reflection-to-nudge flow has all real adapter implementations; C7/C8 schema, fixtures and guards are reviewed before shared discovery is enabled.

**When blocked:** Credentials can defer live execution, not implementation of identity/consent checks. Keep all data synthetic until the real boundary passes.

## AI-R2 · Ship the nearby introduction vertical slice

**Shared allocation:** 22% of remaining time.

**Implement:** Implement bounded logical agent exchange over C8-approved cards after deterministic eligibility. Produce an introduction suggestion or no action, never an unsolicited message. Skip model calls for zero choices; benchmark deterministic single-choice mode; recheck profiles/blocks before commit.

**Your exit evidence:** At most one initial call plus one permitted repair for a shortlisted proposal; zero raw journals/coordinates in prompts; stale opt-out cannot publish.

**Next consumer:** CS: proposal/result state; Sumedh: generation-race cases; Nimisha: outcome vs ranking evidence.

**Shared gate:** A newcomer sees opted-in public profiles before sending an invite, receives a concrete reason to connect, and can decline, withdraw or block. Direct interaction requires recipient acceptance.

**When blocked:** If density is low, show a truthful empty state plus public events. Never invent real nearby users or silently widen location precision.

## AI-R3 · Connect people through local events and shared plans

**Shared allocation:** 22% of remaining time.

**Implement:** Add bounded event-based introduction and shared-plan proposals selected only from normalized catalogue IDs. Distinguish discovery opt-in from pair activity approval. Implement expiry/cancel/retry handling and human acceptance of the same proposal revision.

**Your exit evidence:** No web/tool action from scraped titles; no automatic RSVP, booking, message or external purchase; profile/event changes suppress stale proposals.

**Next consumer:** CS/Cyber: exact proposal state and guarded finalization; Nimisha: decision traces without private content.

**Shared gate:** Two users discover the same source-backed local event, explicitly choose to connect, and accept a current shared plan. Existing partner/friend/family journeys still work.

**When blocked:** If the source is unavailable, keep cached age visible or show unavailable. Synthetic events remain labeled; never claim a live Apify integration from fixtures.

## AI-R4 · Improve usefulness, efficiency and failure behavior

**Shared allocation:** 15% of remaining time.

**Implement:** Measure 10+ eligible provider runs when keys arrive. Right-size reflection output/model using quality checks; add request dedupe without persistent private-result cache, total deadlines/cancellation, retry policy and worker concurrency bounds. Track all usage/fallback outcomes. Verify token expiry and stateful audio resampling across small microphone frames; bound browser TTS input.

**Your exit evidence:** Cost per successful useful result, median/p95 including failures, model/cache/attempt counts; retained safety checks; no unsupported savings claim.

**Next consumer:** CS: tested runtime budget; Cyber: dedupe/retention boundaries; DS: quality regression cases.

**Shared gate:** All three experiences have useful outcomes, measured call budgets and passing current privacy gates. Known failures remain visible; targets are not reported as achievements.

**When blocked:** Cut extra feeds, animations or free-form agent negotiation first. Never cut consent checks, explicit public-profile opt-in or block/withdraw behavior.

## AI-R5 · Morning live verification and release candidate

**Shared allocation:** 12% of remaining time.

**Implement:** Verify direct Claude reflection, Cartesia STT/TTS, deployed Factory worker and database-backed commit. Test mic denial, stop/cancel, token expiry, cold/warm calls and upstream failure with total budget limits.

**Your exit evidence:** Provider-by-provider success and end-to-end trace reported separately; no fixture policy or preferences in live mode.

**Next consumer:** CS: worker runbook/restart; Cyber: sanitized processing and token trace.

**Shared gate:** A fixed candidate revision works with actual providers and authoritative state. Each failure has a named owner; no mocked/live ambiguity.

**When blocked:** If a provider fails, typed input/no suggestion and truthful source-unavailable states remain. Do not put keys into logs or switch to production fake adapters.

## AI-R6 · Freeze, hand off and reserve recovery time

**Shared allocation:** 8% of remaining time.

**Implement:** Freeze prompt/model/call-budget configuration and verify worker health/restart. Document cancellation and safe provider-failure behavior.

**Your exit evidence:** No last-minute tool expansion or unmeasured model switch.

**Next consumer:** CS: runtime recovery and final provider evidence.

**Shared gate:** Code, configuration, evidence and team handoffs describe the same release. The product is ready for a controlled demonstration.

**When blocked:** Buffer is for release recovery, not another product pivot. Keep the user-requested personal analysis report local.

## Interface and review rules

Use the existing canonical schemas and ports. New C7/C8 wire shapes need affected producer/consumer review and Cyber boundary review, source exports, generated schemas, fixtures and direct rejection tests. A planning document does not authorize a new runtime disclosure. Do not import another owner's internals; expose the rank/feature boundary deliberately.

Keep journals, raw quiz extras and precise coordinates out of shared state, provider catalogue requests, agent logs and tests. Discovery can use only published profile/event fields under the separate C8 consent; pair signals retain named-recipient approval. No unrestricted agent conversation or automatic personal messages.

## Verification and handoff

Run the checks applicable to changed files plus root `npm run check`; shared/release changes require `check:all`, `ai:check` and the app build. Distinguish mock/harness checks, implemented adapters, deployment and live runs. Never represent an offline policy or seeded user as real discovery.

Append the exact task/commit/files/verification/next consumer/blocker in your role update log; refresh your handoff. Consumers ACK actual usable interfaces. Read all four logs hourly and before interface edits; raise blockers within 15 minutes. Preserve role branch work when merging main. The personal assessment requested by the user stays local; implementation evidence belongs in normal role logs.
