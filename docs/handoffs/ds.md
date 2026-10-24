# DS handoff
Status: quiz fixtures, rule-based matching baseline and 30-case evaluation set implemented and verified offline in the working tree; not committed/pushed (awaiting owner approval). Nothing here is live.

Read AGENTS.md, PRD.md, PROJECT_KNOWLEDGE.md, contracts/README.md, and docs/roles/ds.md. Work on the corresponding role branch. Do not use fake adapters in live mode.

## Update at each handoff
- UTC timestamp and branch/commit: 2026-10-24T03:24Z, `role/ds-context` @ `8e208df` (origin/main merged, no conflicts) + uncommitted changes.
- Completed work and interface IDs:
  - `src/evaluation/fixtures/quiz.json` v2: Q1–Q8 mapped on the app's `QuizAnswers` keys to C1 `LocalConnectionProfile` and app-side `LocalQuizExtras` (D015). No question grants consent or confirms/assigns a preset.
  - `src/evaluation/fixtures/quiz-profiles.json` v2 (CS): 8 complete `QuizAnswers` cases (partner/friend/family-leaning, space-only, space-with-modes, skip-all = `EMPTY_ANSWERS`, partial skip, note-without-other) with expected `profile`, `extras`, `supportAction`; 4 invalid answers.
  - `src/evaluation/matching.ts`: rule-based baseline. `buildPreview` narrows an owner-only candidate to the confirmed preset of the named, assigned recipient (quiz drafts are not an input); `matchSignal` takes the `DisclosurePolicyPort` result as input and never grants consent; `intersectAvailability`; `buildNudge` (C5, expiry ≤ 24h and ≤ signal expiry).
  - `src/evaluation/fixtures/evaluation-cases.json` (AI/Cyber): 30 synthetic cases — 6 partners, 6 friends, 6 family, 6 privacy attacks, 6 no-action (revoked, expired, unlinked, quiet hours, cooldown, incompatible). Each has privateContext, forbiddenDisclosures, candidate, preset + assignment, submitted vs approved envelope, recipient ACK, delivery state and expected preview / policy reason / match. Seeds: p1 partners, f1 friends, fa3 family (mirrors contracts/fixtures/scenarios.json family).
  - `src/evaluation/__tests__/{quiz-fixtures,evaluation}.test.ts`, picked up by `npm run test:app`.
  - Removed `relationship-scenarios.json` and `tests/fixtures.test.mjs` (superseded; their cases live on as p1, f1, f5, fa2, fa3).
- Verification (offline only, actual results): after `npm ci`, `npm run check:all` exit 0 — contracts 14/14, module 16/16, typecheck clean, test:app 62 pass / 0 fail / 1 todo. The todo is case a3 (known gap below), not a pass. One-off conformance run of quiz-profiles.json against CS `buildProfile`/`buildQuizExtras`: 8/8 equal; 3/4 invalid answers rejected (auto-share-review accepted by CS). Policy outcomes come from the C6 fake: not security evidence.

## Consumer and exact next action
- **CS:** (1) Add a test under `src/components/feature/__tests__/` that loops `src/evaluation/fixtures/quiz-profiles.json`: `deepEqual(buildProfile(c.answers).data, c.expected.profile)` and `deepEqual(buildQuizExtras(c.answers), c.expected.extras)`; for `invalidAnswers` (patches over `EMPTY_ANSWERS`) expect rejection. (2) Validate `LocalQuizExtras` at runtime before `saveQuizExtras` (`reviewComfort: "auto_share"` currently passes). (3) Answer DS-Q2. (4) Mint signal IDs server-side in `approve_signal` (case a3).
- **AI:** The coordinator must reproduce `expected.match` for all 30 cases. Inputs per case: `submittedSignal`, the policy result, `ack`, `delivery`, clock `2026-10-24T00:00:00Z`. Check order: `matchCheckOrder`. Rules: no intersection of support modes = no nudge (never ask for more detail); windows intersect (`today` ⊂ `this_week`, `no_preference` = any) and are never invented when one side omits them; one nudge per pair per 24h; quiet hours suppress; `LocalQuizExtras.prefersSpace` = offer no candidate. Candidate fields outside the enums (e.g. `reason`, `friday_after_exam`) must never be copied. Nothing in `forbiddenDisclosures` may appear in any envelope, ACK or nudge.
- **Cyber:** Review the evaluation-cases privacy boundary (a1–a6), the a3 gap and DS-Q3. Use the cases as fixtures for the real `approve_signal` guard; the expected policy reasons match the C6 fake today.

## Blockers / unresolved contract decisions
- **a3 (privacy gap):** `ApprovedSignal.signalId` accepts any string, so a client-chosen `exam-friday-panic` passes schema and fake policy and would reach the recipient in `Nudge.sourceSignalIds`. Needs server-minted opaque IDs (CS/Cyber). Tracked as a `todo` test.
- **DS-Q2 (CS):** Q2 "when a friend goes quiet" describes how the owner reaches out but is merged into `preferredSupportModes` (what the owner wants to receive). DS recommends local-only; fixtures follow main until decided.
- **DS-Q3 (Cyber):** the family seed shares `availability: no_preference`. Keep it, or omit availability unless it narrows the window?
- `LocalQuizExtras` has no runtime schema (CS/Cyber).
- D015 still lists Cyber/AI review as pending.
- DS-local vocabulary: `presetConfirmation: "owner_narrowed_suggestion"` (case p6) extends D015's two values.

## Planned work
Hour 7: profile-aware ranking adapter on top of `matching.ts` (use `preferredSupportModes`, `suggestionIntensity`), sample .ics coarse-availability parsing, cooldown fixtures. Hour 17–22: score AI outputs against the 30 cases versus this baseline; usefulness ratings (2 raters, 1–5) on eligible positive cases; report sample size honestly.

## Run
```sh
npm ci
npm run check:all                                    # includes DS tests via test:app
node --test "src/evaluation/__tests__/*.test.ts"     # DS only (after npm run build)
```
