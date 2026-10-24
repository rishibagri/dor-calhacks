# Sumedh — Cyber — revised implementation plan

**Branch:** `role/cyber-privacy`. **Baseline:** main `d7285eb`. **Task IDs:** `CYBER-R0` through `CYBER-R6`.

## Your outcome and owned files

Vault, authoritative consent and discovery safety, plus privacy-control feature components.

**Owned implementation:** src/vault/, src/privacy/; claimed guard/delivery/coordination reducers and worker views; proposed src/features/privacy/; contracts policy and catalogue guards. New `src/features/` folders are assignments, not shipped components. Claim exact files in your own update log before editing shared surfaces.

## Already implemented — preserve it

LocalVault and recovery, one canonical policy, F5/F7 reducers, worker-only views and Apify query/link guards are on main through d7285eb. Do not repeat this work. Recipient preference consent/commit binding, timed expiry, audience validation, rate limits and real-browser verification remain.

## Product reset

dor now supports existing relationships, nearby introductions and meeting people through local events. Use one-time approximate location and explicitly published public profiles visible before an invitation is accepted. No journal is required for discovery. Existing support signals/presets never grant stranger access. Read [LOCAL_CONNECTIONS](../features/LOCAL_CONNECTIONS.md), [C8 discovery](../../contracts/specs/DISCOVERY.md) and [README](../../README.md).

R phases replace old P scheduling only. Keep old commit-specific handoff history. Use the actual time remaining in the original 36-hour sprint; percentages are estimates, not a reset of the clock. Each person owns code, tests and a usable feature component so CS is not the sole implementer.

## CYBER-R0 · Reconcile the latest build and freeze the new seams

**Shared allocation:** 3% of remaining time, at most 30 minutes.

**Implement:** Keep LocalVault, F5/F7 reducers and D028 guards. Review C8 public-profile/approximate-area proposal separately from C3 pair consent. Claim support-preference storage, expiry and audience guard files.

**Your exit evidence:** No silent extension of relationship presets or Apify query input; review checklist assigned.

**Next consumer:** All: schema/reducer rejection cases and precise permitted fields.

**Shared gate:** Every missing interface has a producer, consumer and file claim. No one repeats completed bootstrap work.

**When blocked:** If a shared schema is unresolved, continue UI/rank/adapter work on explicitly synthetic fixtures; shared delivery remains disabled.

## CYBER-R1 · Finish the existing connection path and implement new discovery contracts

**Shared allocation:** 18% of remaining time.

**Implement:** Implement authoritative recipient support-preference consent and bind its ID/version and expiry into commit_nudge. Add JWT audience validation and expiry/snooze enforcement. Build vault create/unlock/recovery/privacy controls as an isolated feature component. Review/implement C8 publish/withdraw/block guards in claimed files.

**Your exit evidence:** Direct-reducer tests cover wrong caller, preference revocation during generation, expired view state and blocked discovery; privacy controls exercise real LocalVault.

**Next consumer:** Adam: preference view/guard; CS: privacy component and guarded state contracts.

**Shared gate:** Existing typed reflection-to-nudge flow has all real adapter implementations; C7/C8 schema, fixtures and guards are reviewed before shared discovery is enabled.

**When blocked:** Credentials can defer live execution, not implementation of identity/consent checks. Keep all data synthetic until the real boundary passes.

## CYBER-R2 · Ship the nearby introduction vertical slice

**Shared allocation:** 22% of remaining time.

**Implement:** Enforce authenticated discovery audience, explicit profile publication, private coarse-area membership and TTL. Implement withdraw, block/report and invite limits. Ensure strangers cannot access pair signals, support preferences, raw quiz answers or exact location.

**Your exit evidence:** Third-account/direct-view tests, withdrawal during generation, repeat-probe limits and invitation replay checks pass offline; browser/live proof still separate.

**Next consumer:** CS: controls and enforcement matrix; Adam: final authorized projection and commit guards.

**Shared gate:** A newcomer sees opted-in public profiles before sending an invite, receives a concrete reason to connect, and can decline, withdraw or block. Direct interaction requires recipient acceptance.

**When blocked:** If density is low, show a truthful empty state plus public events. Never invent real nearby users or silently widen location precision.

## CYBER-R3 · Connect people through local events and shared plans

**Shared allocation:** 22% of remaining time.

**Implement:** Implement reviewed C7 activity approvals, C8 event-intent visibility, own-action acceptance and finalization guards. Validate source freshness, both current approvals and matching proposal revision. Review optional public venue tags without habitual-visit disclosure.

**Your exit evidence:** Wrong event/user/revision, one-sided acceptance, revoke-after-first-accept, block and expired catalogue all refuse finalization.

**Next consumer:** All: green boundary tests; CS: exact preview copy and event-intent withdrawal.

**Shared gate:** Two users discover the same source-backed local event, explicitly choose to connect, and accept a current shared plan. Existing partner/friend/family journeys still work.

**When blocked:** If the source is unavailable, keep cached age visible or show unavailable. Synthetic events remain labeled; never claim a live Apify integration from fixtures.

## CYBER-R4 · Improve usefulness, efficiency and failure behavior

**Shared allocation:** 15% of remaining time.

**Implement:** Run cross-user access, payload injection, withdrawal/revocation races, account switch and browser vault tests. Validate rate-limit scope across instances, expired token behavior, metadata-only telemetry, source-link safety and profile abuse controls.

**Your exit evidence:** Current fixed adversarial suite passes; no sender-visible recipient outcome codes; no unsupported provider-retention or E2E claim.

**Next consumer:** All: release-blocking findings and exact reproduction; CS: privacy acceptance conditions.

**Shared gate:** All three experiences have useful outcomes, measured call budgets and passing current privacy gates. Known failures remain visible; targets are not reported as achievements.

**When blocked:** Cut extra feeds, animations or free-form agent negotiation first. Never cut consent checks, explicit public-profile opt-in or block/withdraw behavior.

## CYBER-R5 · Morning live verification and release candidate

**Shared allocation:** 12% of remaining time.

**Implement:** Repeat direct reducer/view attacks on deployed identities and inspect browser network/IndexedDB. Verify preference revocation at commit, profile withdraw/block, timed expiry, account switching and provider notices.

**Your exit evidence:** Live access control evidence accompanies harness results; any leak blocks real-user mode.

**Next consumer:** Team: explicit privacy release conditions and honest limitations.

**Shared gate:** A fixed candidate revision works with actual providers and authoritative state. Each failure has a named owner; no mocked/live ambiguity.

**When blocked:** If a provider fails, typed input/no suggestion and truthful source-unavailable states remain. Do not put keys into logs or switch to production fake adapters.

## CYBER-R6 · Freeze, hand off and reserve recovery time

**Shared allocation:** 8% of remaining time.

**Implement:** Review only changed security boundaries; confirm no debug credentials, public private tables or raw journal traces. Document key-loss and withdrawal limits.

**Your exit evidence:** No known unauthorized disclosure; unresolved limits are named.

**Next consumer:** Team: final boundary state and follow-up owner.

**Shared gate:** Code, configuration, evidence and team handoffs describe the same release. The product is ready for a controlled demonstration.

**When blocked:** Buffer is for release recovery, not another product pivot. Keep the user-requested personal analysis report local.

## Interface and review rules

Use the existing canonical schemas and ports. New C7/C8 wire shapes need affected producer/consumer review and Cyber boundary review, source exports, generated schemas, fixtures and direct rejection tests. A planning document does not authorize a new runtime disclosure. Do not import another owner's internals; expose the rank/feature boundary deliberately.

Keep journals, raw quiz extras and precise coordinates out of shared state, provider catalogue requests, agent logs and tests. Discovery can use only published profile/event fields under the separate C8 consent; pair signals retain named-recipient approval. No unrestricted agent conversation or automatic personal messages.

## Verification and handoff

Run the checks applicable to changed files plus root `npm run check`; shared/release changes require `check:all`, `ai:check` and the app build. Distinguish mock/harness checks, implemented adapters, deployment and live runs. Never represent an offline policy or seeded user as real discovery.

Append the exact task/commit/files/verification/next consumer/blocker in your role update log; refresh your handoff. Consumers ACK actual usable interfaces. Read all four logs hourly and before interface edits; raise blockers within 15 minutes. Preserve role branch work when merging main. The personal assessment requested by the user stays local; implementation evidence belongs in normal role logs.
