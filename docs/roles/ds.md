# DS — Nimisha: preference model, activity matching and evaluation

Branch: `role/ds-context`

## Your outcome
Make suggestions worth acting on. Turn explicit quiz choices into editable preferences, match only eligible approved information against real activity options, and measure useful suggestions and correct no-action outcomes. Own data logic, not just a spreadsheet or a final report.

## Owned implementation
`src/evaluation/`, pure quiz/profile/ranking modules, evaluation datasets/results; claim `src/components/feature/quiz-model.ts` and its tests with CS before changes because a starter implementation already exists. Shared synthetic fixtures in `contracts/fixtures/` require consuming-owner and privacy review.

## Boundaries with other people
CS owns Apify collection, catalogue endpoint and app UI rendering. You own normalization expectations, ranking/compatibility and quality criteria. Adam calls your pure matching hook from orchestration. Sumedh decides permission eligibility; ranking cannot override a deny. Never gather real private journals for an evaluation dataset.

## Current starting point
An eight-question app quiz and D015 mapping already exist on main. Fixtures include confirmed presets and recipient assignments; friends omit availability, family sharing is explicit beyond the suggested preset. Q1 space is local-only `prefersSpace`; Q5/Q6/Q8 remain in local vault extras. Review this before replacing any mapping.

## Your first action
Inspect D015, `src/components/feature/quiz-model.ts`, local quiz extras, and all three scenario fixtures. ACK or identify a concrete mapping issue. Deliver deterministic expected profiles, no-action cases and the proposed ranking input/output to CS and Adam before advanced scoring.

## How to use these phases
Times are targets relative to the original 36-hour start, not a new 36-hour allocation. Check current main, your remote role branch, the shared dashboard and your existing handoff first. Preserve completed work and evidence; skip a phase only when its exit conditions are met. If the sprint is already underway, start at the first unmet gate. Report schedule risk rather than silently moving deadlines. Planning remains capped at the original 30 minutes.

Each phase has a named artifact, a check, and a consumer. Open small PRs every 2–3 hours. Log blockers within 15 minutes; continue independent work with explicit synthetic fixtures, never a production bypass. Each person owns their implementation, tests and run instructions. CS integrates the pieces; CS does not implement everyone else's logic.

## P0 · T+0–0:30 · Agree interfaces and claim work

- **Build:** Agree the eight question outcomes, local-only fields and meaningful support modes. Define partner/friend/family expected results and claim quiz semantics from CS.
- **Exit evidence:** Every answer has an explicit local mapping or remains omitted; no personality diagnosis or automatic consent.
- **Hand off:** CS: quiz copy/mapping decisions. Sumedh: fields that must remain local.

## P1 · T+0:30–3 · Unblock the other three owners

- **Build:** Produce reviewed profile fixtures, confirmed-preset scenarios and initial labeled expected outcomes; define ranking port and catalogue fields with CS/Adam.
- **Exit evidence:** Fixtures validate; space, skip, empty preferences and blocked categories have expected no-action behavior.
- **Hand off:** CS: quiz expectations and catalogue requirements. Adam: deterministic matching contract proposal.

## P2 · T+3–7 · Build the private-to-approved path

- **Build:** Implement pure quiz-to-profile mapping and eligible action ranking; author the 30-case dataset: 6 partners, 6 friends, 6 family, 6 privacy attacks, 6 no-action cases.
- **Exit evidence:** Same inputs produce same outputs; missing data is not invented; all cases have expected outcome before model runs.
- **Hand off:** Adam: tested rank hook. CS: owner-only profile result and preset suggestion data.

## P3 · T+7–12 · Join the real two-user flow

- **Build:** Integrate ranking against approved signals/recipient consent and synthetic catalogue items, then CS’s normalized live catalogue when available. Include format, coarse time compatibility and activity expiry.
- **Exit evidence:** No prohibited field is needed for a ranking decision; expired or incompatible options return no suggestion.
- **Hand off:** Adam: rank result, stable IDs and allowed rationale codes; no raw-text hidden cause.

## P4 · T+12–17 · Complete all three relationship scenarios

- **Build:** Run three complete scenarios and activity matching examples. Add a rule-based baseline, duplicate/cold-start cases and feedback interpretation. Keep local-only preferences out of shared worker inputs.
- **Exit evidence:** Shared explanations contain only approved reasons; two-person overlap is real, not assumed from one person’s journal.
- **Hand off:** CS: meaningful activity-card states; Sumedh: source-field/disclosure matrix.

## P5 · T+17–22 · Validate quality, privacy and recovery

- **Build:** Freeze evaluation set, run model/agent and baseline comparisons, have two teammates rate eligible suggestions 1–5. Report relevance and false-positive/no-action errors separately.
- **Exit evidence:** Publish actual counts/sample size and failures; target >=4 mean usefulness is reported as a target, never fabricated.
- **Hand off:** Team: prioritized defect list linked to case IDs; Adam: counterexamples to fix.

## P6 · T+22–27 · Finish activity discovery and selected depth

- **Build:** Improve matching on diagnosed errors; support real catalogue ranking and both-person acceptance feedback after contract review. If .ics is useful, parse locally and export only explicitly approved coarse windows.
- **Exit evidence:** Useful results do not require private calendars, precise location or medical/emotional labels.
- **Hand off:** CS/Adam: stable ranked examples for approved activity flow.

## P7 · T+27–31 · Stabilize the release candidate

- **Build:** Rerun frozen cases against release candidate and document changed results/baseline; stop tuning if new changes lack evidence.
- **Exit evidence:** Results reproducible from revision/seed/config, with live provider and fixture runs distinguished.
- **Hand off:** Team: final evaluation report and exact run command.

## P8 · T+31–34 · Freeze and document

- **Build:** Document final mappings, limitations, edge cases and source coverage. Confirm activity cards never imply guaranteed ticket availability or compatibility.
- **Exit evidence:** A teammate can reproduce the quality checks without real journals.
- **Hand off:** CS: release quality summary; all: remaining risks.

## P9 · T+34–36 · Release buffer and support

- **Build:** Provide regression triage and validate only release-blocking changes; preserve datasets/results.
- **Exit evidence:** No last-minute unlabeled test-set retuning or unsupported claims.
- **Hand off:** Team: final quality state and follow-up cases.

## Verification you own
- Contract fixture checks plus quiz mapping tests already in the app; add meaningful ranking/evaluation checks in owned modules.
- Correct no-action for space/paused preference, no mutual fit, missing required consent, expired activity and empty catalogue.
- Report target vs actual usefulness, coverage, error counts and latency separately.
- Public catalogue content is untrusted data; no ranking output can mint consent or impersonate either participant.

## Completion and communication
Update `docs/updates/ds.md` and `docs/handoffs/ds.md` at each meaningful handoff with task ID (`DS-P#`), UTC timestamp, branch/commit, files/contracts, actual verification, next named consumer action and blockers. Log a consumer ACK when integration succeeds. Read all four update logs hourly and before shared interface changes. Refresh shared status only from verified or clearly attributed evidence. Do not overwrite another role’s history.

Read [the shared dependency plan](../PLAN.md) and [the Apify feature plan](../features/ACTIVITY_DISCOVERY.md). Demo/video production remains separate in docs/DEMO.md.
