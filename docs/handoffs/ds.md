# Current coordination update — Nimisha (DS)

Read your updated detailed plan in docs/roles/ds.md and shared README.md phases. Task IDs are DS-P#; Cyber uses CYBER-P#. CS owns Apify ingestion; Nimisha matching; Adam bounded proposals; Sumedh disclosure/vault. Preserve existing work and review the main/role-branch status before selecting the first unmet phase. Forwardable message: docs/team-messages/ds.md. This notice does not ACK or complete any pending implementation/contract review.

---

# DS handoff
Status: rank hook, activity ranking, 12 labeled activity cases + baseline report and the 30-case support evaluation are committed on `role/ds-context` and verified offline with synthetic data. Nothing here is live: no catalogue source, provider, deployment or real policy wiring was exercised.

## Update at each handoff
- 2026-10-24T03:55Z, `role/ds-context` @ `af2fb9b` (code) on top of main `9096f81`, plus a docs commit.
- **DS-P2/P3 delivered:**
  - `src/evaluation/rank.ts`
    - `rankAckOptions(options, signal) → options`: AI coordinator `rank` hook. It is pure and only reorders or drops: duplicates, other modes, windows broader than the approved one, or a window when the sender approved none. Ordering is `today` → `this_week` → `no_preference` → none, keeping the recipient's order on ties. Inputs are the approved envelope and consented options only.
    - `rankActivities(input) → { kind: 'ranked', suggestions: [{activityId, score, rationale[]}], excluded } | { kind: 'no_suggestion', reason, excluded }`. Input: `agreed` (option both sides agreed to, or null), `catalogue` (untrusted rows), `approvedInterests` (`{sender, recipient}` from reviewed C7 consent; null today), `now`, `utcOffsetMinutes` (recipient's, from delivery state), `allowedSourceSites`, `limit` (default 3).
    - Exclusion reasons: `invalid_item`, `unsafe_url`, `source_not_allowed`, `format_out_of_scope` (in-person; online-only increment), `expired_source` (>72h or `expired`), `duplicate`, `time_unverified`, `already_started`, `starts_too_soon` (<30 min), `outside_window`. "Today" ends at the recipient's local midnight; `this_week` is 7 days; none/`no_preference` is a 14-day horizon.
    - No-suggestion reasons: `no_agreed_option`, `not_shared_activity`, `empty_catalogue`, `no_eligible_activity`, `no_strong_match` (score < 2).
    - Rationale codes: `scheduled_moment` +2, `on_demand` +1, `short_duration` (≤90 min) +1, `mutual_interest` +3 (both sides), `cached_source` −1.
  - `ActivityItem` (in rank.ts) is a DS consumer proposal for C7: `activityId, sourceUrl (https, host = sourceSite), sourceSite, title, summary, format, categories[ACTIVITY_CATEGORIES], schedule {scheduled startAt/endAt | on_demand | unknown}, durationMinutes|null, fetchedAt, freshness`. It is not a contract type.
  - Fixtures: `activity-catalogue.json` (17 synthetic rows), `activity-cases.json` (12 cases, labels written before runs). `metrics.ts` + `report.ts` → `src/evaluation/results/latest.md`.
- **Mapping questions resolved (D027):** DS-Q2 keeps the mapping and changes only the Q2 copy (CS edit). DS-Q3: `no_preference` = no scheduling information; family fixture kept. Q5 `activities` remains local and never reaches the ranker.

## Results (actual, `results/latest.md` @ af2fb9b)
| Case set | Metric | DS | Baseline |
|---|---|---|---|
| Support, 30 cases (`matching.ts`) | Expected outcome | 29/30 | — |
| Support | False nudges | 1 (a3, known gap) | — |
| Support | Correct no-action | 22/23 | — |
| Activities, 12 cases | Top-1 relevant | 6/6 | 1/6 (soonest-first) |
| Activities | Mean precision@3 | 0.78 | 0.36 |
| Activities | Cases with false suggestion | 0/12 | 9/12 |
| Activities | Correct no-action | 6/6 | 3/6 |

Caveats: one annotator (DS), who also designed the ranker, so the activity numbers are optimistic. Teammate 1–5 usefulness ratings have not been collected, so no usefulness mean exists. The precision@3 loss is `act-injection-text`, a valid listing with an instruction-like title that ranks 2nd in ac1/ac3/ac10/ac12. The text is inert (tested), but it should not be shown: CS sanitize/flag defect.

## Consumer and exact next action
- **AI (Adam):** Construct `BoundedCoordinator` with `rank: rankAckOptions`. Scratchpad check at af2fb9b: 13/13 AI fixture cases give the same outcome with the hook, and the two-window friends case orders `today` first. Agree an import path (`src/evaluation` is app-side; options: move `rankAckOptions` into contracts, or a small `@kinetic/ranking` workspace). For activity proposals, call `rankActivities` only after a compatible ACK, and send only `activityId` + rationale codes to the proposal step.
- **CS:** (1) Q2 copy in `src/app/onboarding/page.tsx`: "2. When you've gone quiet for a while, what would you like from a friend?" (2) Compare C7 `ActivityCatalogueItem` with `ActivityItem` fields; DS needs `format`, normalized `categories`, a `schedule` that distinguishes on-demand from unknown, `durationMinutes|null`, `fetchedAt` and `freshness`. (3) Sanitize or flag instruction-like titles before display. (4) Still open: test looping `quiz-profiles.json`; `LocalQuizExtras` runtime validation.
- **Cyber (Sumedh):** Review D027(d). Propose an `activity_interest` consent category whose record fills `approvedInterests`; until then it stays null. Pure-guard opaque signalId check would let case a3 pass offline.
- **Team:** Rate the top-3 of ac1, ac2, ac3, ac10, ac11 and ac12 on a 1–5 scale (2 raters) and record the ratings in `results/`.

## Blockers
- No C7 schema or activity-interest consent: person-specific activity delivery is blocked (catalogue read-only per PLAN.md G6).
- No live catalogue (CS-P0/P1 Actor not yet selected), so every activity result is synthetic.
- a3 stays a todo offline (mitigated in `approve_signal` via server `newId`, harness-only).

## Run
```sh
npm ci
npm run check:all                                   # includes DS tests via test:app
npm run build && node --test "src/evaluation/__tests__/*.test.ts"
node src/evaluation/report.ts --write              # regenerates results/latest.md
```
