# Acceptance and evaluation contract v1

## Product checks
- Two authenticated users can accept a pair invite; a third user cannot access it.
- Voice record/stop/reflection works; denied mic and provider errors offer typed entry.
- Journal is visible only to its owner, including through direct provider/API requests and database subscriptions.
- For D050, a uniquely resolved accepted connection enters the automatic flow without a per-nudge approval tap; ambiguous names require clarification. Private risk suppresses unsafe flows. Only allowlisted signal fields can reach the two-agent coordinator.
- Bounded agent exchange produces a useful inbox nudge from approved inputs.
- Recipient opt-out, owner pause, cooldown, configured quiet hours, revocation, and unlink behave consistently.
- Serious-distress terms immediately show the support-resource card, suppress the relationship flow, and never contact a connection.
- Partners, friends, and family each have a reproducible complete seed and reset path.

## Evaluation set (DS)
Build 30 synthetic cases: 6 partners, 6 friends, 6 family, 6 privacy attacks, 6 no-action cases (revoked, expired, unlinked, quiet hours, cooldown, incompatible preferences). Include a simple rule-based baseline. Store expected allow/deny, compatible action, and forbidden disclosures before running model outputs.

Release bar: all deterministic privacy tests pass; no forbidden fields cross the boundary in the fixed set; 100% expired/revoked/unlinked cases suppressed. Two teammates rate usefulness 1–5 and compare with baseline; target mean >=4 on eligible positive cases, report actual results and sample size without presenting them as a general privacy guarantee. “No nudge” is correct for incompatible or unauthorized input.

AI records median/p95 voice and nudge latency over at least 10 seeded runs; target <=3 seconds for first audible response after turn completion and <=8 seconds for nudge generation. These are targets until measured. Include provider failures and recovery.

## Contract fixtures
contracts/schema/approved-signal.schema.json is a strict boundary schema proposal. Runtime code must additionally enforce authenticated identity, consent record/payload equality, current membership/version, expiry, and revocation. JSON Schema validity alone never grants permission. contracts/fixtures/scenarios.json contains synthetic interface fixtures, with deliberately far-future expiries for static readability; reset scripts must replace them with realistic relative expiries before test runs.

## Evidence
Each role logs commands/results or reproducible manual steps. No claim of implemented protection from the existence of this checklist.

## dor stack and onboarding acceptance
- Local vault locks/unlocks, ciphertext persists without plaintext transcript, and clearing storage/recovery behavior is explicit.
- SpacetimeDB direct reducer calls and subscriptions cannot bypass API checks; caller identity and policy versions are enforced.
- Different assigned presets produce different allowed enum payloads for the same private input; same-preset connections share category rules. Quiz selection/skip does not create or broaden consent. Recipient opt-out and pause block default-on nudges for that pair.
- Factory executes a real event-triggered bounded workflow in its deployed compatible worker; no private journal content in sessions, work queues or logs.
- Cartesia transcription and voice are exercised live; provider-processing notices accurately describe the tested path.
- No source-ID leakage from local vault; receipts link only approved signal IDs.

## Expanded connection acceptance (R-phase reset)
Retain partner/friend/family cases; add newcomer and same-local-event journeys. Discovery must work without a journal. Assert one-time location is coarsened before network transmission; opted-in public fields visible before invitation acceptance; no unauthenticated/blocked/expired/withdrawn profile leakage; no automatic preset assignment; direct contact acceptance; explicit event intent and both-party same-revision plan confirmation. A source listing is never evidence of attendance.

DS adds at least 12 labeled nearby/event cases, including empty/sparse area, cell edge, duplicate/expired event, one-sided intent, blocked profile and withdrawal during generation. Keep author-labeled synthetic relevance separate from two teammate ratings on held-out examples. Evaluate useful human actions, not bot message volume.

Measure calls and total latency per journey: no model call on feed/denial/no-fit; bounded shortlisted proposals; one shared catalogue refresh per configured window; request replay/cancellation/concurrency failures. Prove real-browser vault, real two-account + denied third-account database path and provider runs at R5. Runtime budgets are targets until measured. Known semantic-ID TODO and provider/runtime limitations must remain visible in results.
