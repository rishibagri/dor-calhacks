# Nimisha — DS — revised implementation plan

**Branch:** `role/ds-context`. **Baseline:** main `d7285eb`. **Task IDs:** `DS-R0` through `DS-R6`.

## Your outcome and owned files

Matching, candidate retrieval requirements, evidence and the discover-results feature component.

**Owned implementation:** src/evaluation/; proposed src/features/discovery/ (cards, reason-code display, empty states; receives authorized data via props); quiz semantics by file claim. New `src/features/` folders are assignments, not shipped components. Claim exact files in your own update log before editing shared surfaces.

## Already implemented — preserve it

Your 30 support cases, 12 activity cases, rankAckOptions and rankActivities are on main through PR #8. Synthetic ranking results exist; independent human ratings do not. C7 ActivityItem is still a consumer proposal; C8 nearby ranking is new work.

## Product reset

dor now supports existing relationships, nearby introductions and meeting people through local events. Use one-time approximate location and explicitly published public profiles visible before an invitation is accepted. No journal is required for discovery. Existing support signals/presets never grant stranger access. Read [LOCAL_CONNECTIONS](../features/LOCAL_CONNECTIONS.md), [C8 discovery](../../contracts/specs/DISCOVERY.md) and [README](../../README.md).

R phases replace old P scheduling only. Keep old commit-specific handoff history. Use the actual time remaining in the original 36-hour sprint; percentages are estimates, not a reset of the clock. Each person owns code, tests and a usable feature component so CS is not the sole implementer.

## DS-R0 · Reconcile the latest build and freeze the new seams

**Shared allocation:** 3% of remaining time, at most 30 minutes.

**Implement:** Keep rankAckOptions, rankActivities and the 30+12 fixtures. Specify discovery ranking fields, bounded candidate retrieval and allowed explanation codes. Claim the new discover-results component and define its props.

**Your exit evidence:** Approved/public inputs are distinguished from private quiz extras; a cold-start case is labeled.

**Next consumer:** CS/Adam: typed consumer requirements and deterministic sample results.

**Shared gate:** Every missing interface has a producer, consumer and file claim. No one repeats completed bootstrap work.

**When blocked:** If a shared schema is unresolved, continue UI/rank/adapter work on explicitly synthetic fixtures; shared delivery remains disabled.

## DS-R1 · Finish the existing connection path and implement new discovery contracts

**Shared allocation:** 18% of remaining time.

**Implement:** Adapt ActivityItem to reviewed C7 without parallel wire types. Implement pure nearby matching using only published interests, approved event intent and permitted area eligibility. Build discover cards/empty states against synthetic C8 data; explain overlap without a compatibility percentage.

**Your exit evidence:** Same input gives same result; block/expiry/missing consent never enters the eligible rank set; empty area stays honest.

**Next consumer:** CS: discover-results component; Adam: canonical pure ranking port and fixtures.

**Shared gate:** Existing typed reflection-to-nudge flow has all real adapter implementations; C7/C8 schema, fixtures and guards are reviewed before shared discovery is enabled.

**When blocked:** Credentials can defer live execution, not implementation of identity/consent checks. Keep all data synthetic until the real boundary passes.

## DS-R2 · Ship the nearby introduction vertical slice

**Shared allocation:** 22% of remaining time.

**Implement:** Finish deterministic shortlist, cap candidates, stable tie-breaks, duplicate removal and no-fit logic. Render chosen public name/avatar/interests and safe reason codes. Add sparse-area, already-connected, withdrawn, blocked and coarse-cell-edge cases.

**Your exit evidence:** Rank never needs a journal, diagnosis, routine or exact distance; public result fields equal the approved profile projection.

**Next consumer:** CS: fully usable discovery feature; Adam: at most top three eligible candidates with allowed reasons.

**Shared gate:** A newcomer sees opted-in public profiles before sending an invite, receives a concrete reason to connect, and can decline, withdraw or block. Direct interaction requires recipient acceptance.

**When blocked:** If density is low, show a truthful empty state plus public events. Never invent real nearby users or silently widen location precision.

## DS-R3 · Connect people through local events and shared plans

**Shared allocation:** 22% of remaining time.

**Implement:** Implement event eligibility and overlap from explicitly published event intent, not scraped attendance. Extend ranker to in-person events/approved coarse area; retain online activities for existing long-distance connections. Build event-result cards and first-session recommendations.

**Your exit evidence:** Duplicate listings resolve consistently; expired/cancelled/wrong-area events excluded; interest is not labeled attendance; no private Q5 export.

**Next consumer:** Adam: event shortlist; CS: components and source-status labels; team: new held-out cases.

**Shared gate:** Two users discover the same source-backed local event, explicitly choose to connect, and accept a current shared plan. Existing partner/friend/family journeys still work.

**When blocked:** If the source is unavailable, keep cached age visible or show unavailable. Synthetic events remain labeled; never claim a live Apify integration from fixtures.

## DS-R4 · Improve usefulness, efficiency and failure behavior

**Shared allocation:** 15% of remaining time.

**Implement:** Add at least 12 nearby/event cases beyond the existing 30 support + 12 activity cases. Get two teammate ratings on held-out useful introductions, measure no-fit/false-match coverage and compare baseline. Track invite accepted and optional plan completion instead of chat length.

**Your exit evidence:** Results separate synthetic labels from human ratings; disclose tiny sample size; evaluate expensive AI against deterministic baseline.

**Next consumer:** All: release decision by case and metric; Adam: cases where model adds measurable value.

**Shared gate:** All three experiences have useful outcomes, measured call budgets and passing current privacy gates. Known failures remain visible; targets are not reported as achievements.

**When blocked:** Cut extra feeds, animations or free-form agent negotiation first. Never cut consent checks, explicit public-profile opt-in or block/withdraw behavior.

## DS-R5 · Morning live verification and release candidate

**Shared allocation:** 12% of remaining time.

**Implement:** Run partner, friend, family, newcomer and same-event scenarios against the release candidate. Verify real source normalization against fixture assumptions and review first-use copy with teammates.

**Your exit evidence:** Actual visible recommendation matches authorized input and source; five scenarios reproducible.

**Next consumer:** CS: release quality verdict and remaining empty/no-fit cases.

**Shared gate:** A fixed candidate revision works with actual providers and authoritative state. Each failure has a named owner; no mocked/live ambiguity.

**When blocked:** If a provider fails, typed input/no suggestion and truthful source-unavailable states remain. Do not put keys into logs or switch to production fake adapters.

## DS-R6 · Freeze, hand off and reserve recovery time

**Shared allocation:** 8% of remaining time.

**Implement:** Freeze fixtures/labels/results and document cold-start/source coverage limits. Validate only changed regression cases after freeze.

**Your exit evidence:** Quality results reproducible without real journals or relabeling misses.

**Next consumer:** Team: quality summary and later research questions.

**Shared gate:** Code, configuration, evidence and team handoffs describe the same release. The product is ready for a controlled demonstration.

**When blocked:** Buffer is for release recovery, not another product pivot. Keep the user-requested personal analysis report local.

## Interface and review rules

Use the existing canonical schemas and ports. New C7/C8 wire shapes need affected producer/consumer review and Cyber boundary review, source exports, generated schemas, fixtures and direct rejection tests. A planning document does not authorize a new runtime disclosure. Do not import another owner's internals; expose the rank/feature boundary deliberately.

Keep journals, raw quiz extras and precise coordinates out of shared state, provider catalogue requests, agent logs and tests. Discovery can use only published profile/event fields under the separate C8 consent; pair signals retain named-recipient approval. No unrestricted agent conversation or automatic personal messages.

## Verification and handoff

Run the checks applicable to changed files plus root `npm run check`; shared/release changes require `check:all`, `ai:check` and the app build. Distinguish mock/harness checks, implemented adapters, deployment and live runs. Never represent an offline policy or seeded user as real discovery.

Append the exact task/commit/files/verification/next consumer/blocker in your role update log; refresh your handoff. Consumers ACK actual usable interfaces. Read all four logs hourly and before interface edits; raise blockers within 15 minutes. Preserve role branch work when merging main. The personal assessment requested by the user stays local; implementation evidence belongs in normal role logs.
