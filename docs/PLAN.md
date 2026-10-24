# Shared execution and handoffs — revised R phases

[README](../README.md) is the detailed master plan. [CS](roles/cs.md), [Nimisha](roles/ds.md), [Adam](roles/ai.md) and [Sumedh](roles/cyber.md) each have concrete R0–R6 artifacts/checks/consumers. R IDs supersede P scheduling; preserve P history. The original 36-hour deadline remains. Assign the actual remaining time before resuming; do not assume another full sprint.

## Critical paths

Existing connection: CS identity/bindings + Cyber real vault/recipient consent → AI provider component and worker adapters → CS app composition → Cyber guarded commit → real two-account verification.

New connection: reviewed C7/C8 → CS coarse-area/profile/indexed state + DS rank/discovery component + Cyber publication/block/expiry guards → AI bounded proposal → human invitation acceptance → public event source + explicit intent → guarded shared-plan acceptance.

These tracks run in parallel, but neither may bypass identity/consent. New discovery does not require journaling. Event source failure must not break existing connections.

## Exact producer → consumer map

| Producer | Artifact / current starting point | Consumer | Due / consumer ACK |
|---|---|---|---|
| CS | Real generated module bindings, Clerk/worker identity mapping | Adam, Sumedh | R1: imports/build and authenticated mapping verified |
| Sumedh | LocalVault exists; lifecycle privacy component and per-account wiring contract | CS | R1: UI create/unlock/recovery/save without plaintext fallback |
| Adam | Existing private reflection client + voice helpers; new feature component | CS | R1: candidate in memory, reflection text only persisted; mic failure typed fallback |
| Sumedh | Missing support-preference consent row/view and commit-time version binding | Adam, CS | R1: revoke during generation blocks actual commit |
| Adam | Worker-side adapters over worker_signal_context, worker_delivery, new preference view and commit_nudge | CS, Sumedh | R1/R2: real policy backed by authoritative rows, no production fake |
| CS + Sumedh | Proposed C7/C8 schemas and publication/area/invitation/event rules | Nimisha, Adam | R0 proposal, R1 reviewed schema/fixtures before runtime delivery |
| Nimisha | Canonical nearby/event rank port and discover-results component | CS, Adam | R1/R2: authorized props only; zero model call for filtering |
| CS | Indexed authorized candidate query and coarse area state | Nimisha, Adam | R2: bounded rows/cursor, no exact location or global dump |
| Sumedh | Profile withdrawal/block/expiry/invitation guards | CS, Adam | R2: direct calls and stale generation denied |
| CS | One normalized Apify catalogue/cache | Nimisha, Adam | R3: stable IDs, source/freshness and actual failure handling |
| Adam + Sumedh | Versioned proposal state and current-consent finalization | CS, Nimisha | R3: two independent acceptances, no automatic external action |
| All | Five scenario traces, quality and call budgets | Release integrator | R4/R5: current revision, synthetic vs live evidence separated |

## File ownership for balanced implementation
- CS retains shared app layout/navigation, composition root, identity/client bindings, module exports/schema integration, deploy and public source adapter.
- Nimisha owns `src/evaluation/` and new `src/features/discovery/` component internals; CS composes the page. Quiz semantics require a claim on the existing shared file.
- Adam owns `src/agents/`, `worker/`, existing provider route files and new `src/features/voice/`. Worker-side bindings mapping is Adam's implementation; CS supplies generated bindings and connection configuration.
- Sumedh owns `src/vault/`, `src/privacy/`, new `src/features/privacy/`, and previously claimed policy/delivery/coordination reducers and worker views. He implements new preference/expiry/audience guards in claimed files, not merely reviews CS work.
- Shared `schema.ts`, `views.ts`, `admin.ts`, exports and `src/lib/backend/ports.ts` need exact section/file claims before edits. One person integrates a shared file at a time; agree the patch rather than editing concurrently.
- Production cross-workstream types come from `@dor/contracts`. DS's current ActivityItem is a consumer proposal; do not export it as a second wire schema. Package the pure rank port deliberately before AI imports it.

## Gates and fallback
R0: owners/seams agreed; R1: existing-flow adapter implementations plus new reviewed contracts; R2: nearby public-profile introduction; R3: source-backed same-event plan; R4: measured quality/efficiency and adversarial checks; R5: real providers/identity/database/browser; R6: stable release/reset/runbook.

Keep R5 verification and R6 buffer when reducing scope. Cut extra sources, groups, calendar OAuth, venue-history inference and cosmetic polish first. Never fabricate live users/events or weaken permission checks. If keys are absent, ship tested adapters and synthetic fixtures, then label live checks pending.

## Communication
Use CS-R#, DS-R#, AI-R#, CYBER-R#. Append own role log with UTC timestamp, branch/commit, exact files/interface, evidence, next named consumer and blocker. Read all role logs hourly and before shared changes; raise blocked interfaces within 15 minutes. Teammates merge main into existing branches without reset/force push. Small PRs every 2–3 hours. New scope does not erase ACK conditions in src/privacy/REVIEWS.md. The user's personal assessment report stays local; team implementation evidence belongs in the repository.
