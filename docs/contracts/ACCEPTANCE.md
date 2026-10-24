# Acceptance and evaluation contract v1

## Product checks
- Two authenticated users can accept a pair invite; a third user cannot access it.
- Voice record/stop/reflection works; denied mic and provider errors offer typed entry.
- Journal is visible only to its owner, including through direct API requests.
- User sees exact allowed signal before approval. Declining creates no shared state.
- Bounded agent exchange produces a useful inbox nudge from approved inputs.
- Dismiss, snooze, cooldown, quiet hours, and unlink behave consistently.
- Partners, friends, and family each have a reproducible complete seed and reset path.

## Evaluation set (DS)
Build 30 synthetic cases: 6 partners, 6 friends, 6 family, 6 privacy attacks, 6 no-action cases (revoked, expired, unlinked, quiet hours, cooldown, incompatible preferences). Include a simple rule-based baseline. Store expected allow/deny, compatible action, and forbidden disclosures before running model outputs.

Release bar: all deterministic privacy tests pass; no forbidden fields cross the boundary in the fixed set; 100% expired/revoked/unlinked cases suppressed. Two teammates rate usefulness 1–5 and compare with baseline; target mean >=4 on eligible positive cases, report actual results and sample size without presenting them as a general privacy guarantee. “No nudge” is correct for incompatible or unauthorized input.

AI records median/p95 voice and nudge latency over at least 10 seeded runs; target <=3 seconds for first audible response after turn completion and <=8 seconds for nudge generation. These are targets until measured. Include provider failures and recovery.

## Contract fixtures
packages/contracts/approved-signal.schema.json is a strict boundary schema proposal. Runtime code must additionally enforce authenticated identity, consent record/payload equality, current membership/version, expiry, and revocation. JSON Schema validity alone never grants permission. demo/scenarios.json contains synthetic interface fixtures, with deliberately far-future expiries for static readability; reset scripts must replace them with realistic relative expiries before tests or demonstrations.

## Evidence
Each role logs commands/results or reproducible manual steps. Demo production acceptance: 90-second film, all three instances, real UI, readable captions, understandable voice, consent and revocation shown, local playback checked. No claim of implemented protection from the existence of this checklist.
