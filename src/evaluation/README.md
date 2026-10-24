# src/evaluation

DS: quiz mapping fixtures, rule-based matching baseline and the 30-case evaluation set. Shared wire fixtures live in contracts/fixtures; evaluation-specific cases belong here.

Read root AGENTS.md, PRD.md, PROJECT_KNOWLEDGE.md, contracts/README.md and your role/handoff before implementation. Import shared schemas/types from @dor/contracts; do not duplicate them.

| File | Purpose | Consumer |
|---|---|---|
| `fixtures/quiz.json` | Quiz mapping spec on the app's `QuizAnswers` keys (Q1–Q8 → `LocalConnectionProfile` / `LocalQuizExtras`) | CS |
| `fixtures/quiz-profiles.json` | 8 full `QuizAnswers` cases with expected `buildProfile` / `buildQuizExtras` output, plus 4 invalid answers | CS |
| `fixtures/evaluation-cases.json` | 30 synthetic cases (6 partners, 6 friends, 6 family, 6 privacy attacks, 6 no-action) with expected preview, policy reason, match/no-nudge and forbidden disclosures | AI, Cyber, CS |
| `matching.ts` | Rule-based baseline: `buildPreview`, `matchSignal`, `intersectAvailability`, `buildNudge` | DS evaluation |
| `rank.ts` | `rankAckOptions` (AI coordinator `rank` hook: reorder/drop only) and `rankActivities` (catalogue ranking for an agreed shared_activity option; IDs + rationale codes out) plus the comparison-only `soonestFirstBaseline` | AI, CS |
| `fixtures/activity-catalogue.json` | 17 synthetic catalogue rows in the DS `ActivityItem` proposal shape (C7 stand-in), incl. duplicate, stale, started, too-soon, in-person, unsafe URL, off-allowlist, undated, malformed and injection-titled rows | CS (normalization expectations) |
| `fixtures/activity-cases.json` | 12 labeled activity cases (6 positive, 6 no-action) with expected order, relevance labels and must-not-suggest sets, written before any run | DS evaluation |
| `metrics.ts`, `report.ts` | Relevance (top-1, precision@3), false suggestions and no-action accuracy for DS ranker vs baseline; `results/latest.md` | Team |
| `nearby.ts` | `rankNearby`: deterministic nearby/event shortlist (top 3) over the authorized C8 candidate page; re-applies block/withdraw/expiry/connected/self, rejects cards with fields outside the projection, overlap only on both people's published tags and current event intents. `mostTagsBaseline` is comparison-only | CS, AI |
| `events.ts` | DS-R3 `eligibleEvents` (in person, viewer's active coarse area, scheduled, upcoming ≥30 min, ≤14 days, source ≤72 h, allowlisted topics; duplicates → latest fetch, cancelled wins ties) and `rankEventCompanions` (per eligible event the viewer published a current intent for, `rankNearby` event-mode companions). Intent is self-declared, never attendance. `EventListing` is a DS consumer proposal (`CatalogueEventRef` + `areaKey`) | CS, AI |
| `fixtures/event-listings.json` | 13 synthetic regional-feed rows, each non-eligible row labeled with its expected exclusion | DS evaluation |
| `fixtures/nearby-candidates.json`, `fixtures/nearby-cases.json` | 15 synthetic candidates, 4 viewers and 15 labeled nearby/event cases (6 positive, 9 no-action) written before any run | DS evaluation |
| `results/ratings-template.md` | Sheet for two independent teammate 1–5 ratings | Team |
| `../features/discovery/` | DS discovery feature: C8 consumer proposal types, pure view-model, `DiscoveryResults` and `EventResults` components (props only) | CS composes the page |
| `__tests__/*.test.ts` | Offline checks over the fixtures and baseline | `npm run test:app` |

Pipeline per case: `buildPreview` (candidate narrowed to the confirmed preset for the named recipient; quiz drafts are never an input) → owner approval → `DisclosurePolicyPort.check` → `matchSignal` (check order in `evaluation-cases.json#matchCheckOrder`) → fixed template nudge or no nudge.

Run: `npm run build && node --test "src/evaluation/__tests__/*.test.ts"` (also part of `npm run check:all`). Policy outcomes use the offline fake from `@dor/contracts/fakes`; passing is not security or live-integration evidence. Case `a3` is a `todo` test documenting a known gap (semantic signal IDs), not a pass.

Activity pipeline: `matchSignal` (or the coordinator's compatible ACK) → agreed option → `rankActivities` → at most 3 activity IDs with rationale codes, or `no_suggestion` with a reason. Ranking never authorizes sharing; interests are used only when both people approved them via reviewed C7 consent (null today).

Report: `npm run build && node src/evaluation/report.ts --write` regenerates `results/latest.md` (deterministic, synthetic, no provider).
