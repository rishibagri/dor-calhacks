# src/evaluation

DS: quiz mapping fixtures, rule-based matching baseline and the 30-case evaluation set. Shared wire fixtures live in contracts/fixtures; evaluation-specific cases belong here.

Read root AGENTS.md, PRD.md, PROJECT_KNOWLEDGE.md, contracts/README.md and your role/handoff before implementation. Import shared schemas/types from @dor/contracts; do not duplicate them.

| File | Purpose | Consumer |
|---|---|---|
| `fixtures/quiz.json` | Quiz mapping spec on the app's `QuizAnswers` keys (Q1–Q8 → `LocalConnectionProfile` / `LocalQuizExtras`) | CS |
| `fixtures/quiz-profiles.json` | 8 full `QuizAnswers` cases with expected `buildProfile` / `buildQuizExtras` output and unsaved preset drafts (`draftCategoriesFor`; suggestions, never consent), checked against CS's functions, plus 4 invalid answers | CS |
| `fixtures/evaluation-cases.json` | 30 synthetic cases (6 partners, 6 friends, 6 family, 6 privacy attacks, 6 no-action) with expected preview, policy reason, match/no-nudge and forbidden disclosures | AI, Cyber, CS |
| `matching.ts` | Rule-based baseline: `buildPreview`, `matchSignal`, `intersectAvailability`, `buildNudge` | DS evaluation |
| `rank.ts` | `rankAckOptions` (AI coordinator `rank` hook: reorder/drop only) and `rankActivities` (catalogue ranking for an agreed shared_activity option; IDs + rationale codes out) plus the comparison-only `soonestFirstBaseline` | AI, CS |
| `fixtures/activity-catalogue.json` | 17 synthetic catalogue rows in the DS `ActivityItem` proposal shape (C7 stand-in), incl. duplicate, stale, started, too-soon, in-person, unsafe URL, off-allowlist, undated, malformed and injection-titled rows | CS (normalization expectations) |
| `fixtures/activity-cases.json` | 12 labeled activity cases (6 positive, 6 no-action) with expected order, relevance labels and must-not-suggest sets, written before any run | DS evaluation |
| `metrics.ts`, `report.ts` | Relevance (top-1, precision@3), false suggestions and no-action accuracy for DS ranker vs baseline; `results/latest.md` | Team |
| `nearby.ts` | `rankNearby`: deterministic nearby/event shortlist (top 3) over the authorized C8 candidate page; re-applies block/withdraw/expiry/connected/self, rejects cards with fields outside the projection, overlap only on both people's published tags and, for events, the viewer's own current intents ∩ the server-authorized mutual `sharedEventIds` (D039: no other person's kind or expiry). `mostTagsBaseline` is comparison-only | CS, AI |
| `events.ts` | DS-R3 over the D039 server projections. `eligibleEvents` narrows `catalogue_events` rows (in person, viewer's own active coarse area by Cyber's area rule, fetched ≤48 h like the server's intent rule, upcoming ≥30 min, ≤14 days; a duplicated ID withholds every copy). `rankEventCompanions` takes companions only from `event_companions` (mutual, no kind) joined to strictly adapted `discovery_cards`, plus the viewer's own `my_event_intents`; it ranks with `rankNearby` event mode and reports every withheld row. Another person's interested/going is never an input or output | CS, AI |
| `fixtures/event-listings.json` | v2: synthetic `catalogue_events` (14 rows, each non-eligible row labeled), `my_event_intents`, `discovery_cards` and `event_companions` rows with expected companions and withheld rows | DS evaluation |
| `fixtures/nearby-candidates.json`, `fixtures/nearby-cases.json` | 15 synthetic candidates, 4 viewers and 15 labeled nearby/event cases (6 positive, 9 no-action) written before any run | DS evaluation |
| `fixtures/decision-cases.json` | Core 1 labels + Core 2 paired scenarios for the owner-only decision loop (v2.2, D040 + D041 + D042 + core3-audit): 55 synthetic cases, 19 of them referencing AI's `src/agents/fixtures/reflection.synthetic.json` by ID (all 10 reflection cases, no copied data), (support/avoid/uncertain) across general-vs-specific, explicit refusal, ambiguous timing, skipped question, changed answer, prompt injection, private party, no candidate, and the audit cases (unnamed connections, duplicate names, D041 pauses, nickname exclusions), each with an expected `no_action` / `needs_clarification` / `ready_for_preview` (README design vocabulary, not a contract) and forbidden-disclosure labels (`unapproved_recipient`, `private_activity`, `location`, `excuse`, `relationship_tension`, `timing_detail`), written before any run; plus a 4-story noninterference set | DS evaluation, CS, AI |
| `decision-loop.ts` | Replays a case through the composition CS's `DecisionLoop` renders: `initialLoopState` → `failClosedWithoutAssessment` (D042: a candidate with no assessment → `no_action: assessment_missing`) → owner taps; recipients `withoutPaused` → `applyUnnamedExclusionGuard` → `assessedRecipients` → `decide` (evaluation-only consumer of CS + AI helpers), collects owner-facing copy, recipient-visible copy and offered/previewed people, and scores outcome, appropriate silence, missed suggestions, unsafe suggestions, excluded people surfaced and forbidden disclosures separately; `resolveCases` fills AI-fixture references; `observable()` for noninterference (preview + nudge schedule) | DS evaluation |
| `decision-baselines.ts` | Core 3 deterministic comparison systems over the same cases: `loop_without_assessment` (CS's loop with the assessment dropped and no D042 guard, the pre-D040 path; historical comparison) and `preview_on_candidate` (DS `matching.ts` `buildPreview` as a "support match is enough" strawman); `d040_loop` is the current pipeline | DS evaluation |
| `fixtures/core4-examples.json`, `core4.ts`, `results/core4.md` | Core 4: 19 existing synthetic cases chosen **by reference** (14 decision-loop, 5 support-signal; partner/friend/family + private party; positive, explicit refusal, uncertainty, recipient-specific permission, correct silence). No label or story is copied; expected outcomes come from the source fixtures. `node src/evaluation/core4.ts --write` regenerates the summary (expected vs actual, privacy checks, sample size, limitations); `--check` fails if it is stale | Team, submission |
| `support-pipeline.ts` | `runSupportCase` (preview → C6 fake policy → `matchSignal` → nudge, plus what crosses to the recipient) shared by the 30-case tests and Core 4 | DS evaluation |
| `ratings.ts`, `rate.ts` | Core 3 teammate rating workflow: blinded sheets, hidden key, strict parser, per-system aggregation, Cohen's κ, rater vs DS-label agreement | DS evaluation, two teammate raters |
| `results/ratings/{rater-a,rater-b}.md`, `results/ratings/key.json` | Generated blank rater sheets (113 blinded items) and the item → case/system key (raters must not open the key) | Two teammate raters |
| `results/ratings-template.md` | Older sheet for the discovery/activity rankers (extension work, not core) | Team |
| `../features/discovery/` | DS discovery feature: C8 consumer proposal types, pure view-model, `DiscoveryResults` and `EventResults` components (props only) | CS composes the page |
| `__tests__/*.test.ts` | Offline checks over the fixtures and baseline | `npm run test:app` |

Pipeline per case: `buildPreview` (candidate narrowed to the confirmed preset for the named recipient; quiz drafts are never an input) → owner approval → `DisclosurePolicyPort.check` → `matchSignal` (check order in `evaluation-cases.json#matchCheckOrder`) → fixed template nudge or no nudge.

Run: `npm run build && node --test "src/evaluation/__tests__/*.test.ts"` (also part of `npm run check:all`). Policy outcomes use the offline fake from `@dor/contracts/fakes`; passing is not security or live-integration evidence. Case `a3` is a `todo` test documenting a known gap (semantic signal IDs), not a pass.

Activity pipeline: `matchSignal` (or the coordinator's compatible ACK) → agreed option → `rankActivities` → at most 3 activity IDs with rationale codes, or `no_suggestion` with a reason. Ranking never authorizes sharing; interests are used only when both people approved them via reviewed C7 consent (null today).

Report: `npm run build && node src/evaluation/report.ts --write` regenerates `results/latest.md` (deterministic, synthetic, no provider).

Core 4: `node src/evaluation/core4.ts --write` regenerates `results/core4.md`; `core4.test.ts` fails if it is stale, and each privacy check has a negative control that must make it fail.

## Teammate ratings (Core 3)
Two teammates rate the decision-loop outcomes independently. Neither may be the DS annotator who wrote the labels.
1. DS runs `node src/evaluation/rate.ts --sheets`. This writes `results/ratings/rater-a.md`, `rater-b.md` and `key.json`. It refuses to overwrite a sheet that already has ratings unless `--force` is given.
2. Send each rater only their own sheet. Raters fill the one-row table under each item: `useful` 1–5, `safe` y/n, `preferred` silent/ask/preview, optional `concerns` (the six forbidden-disclosure labels plus `unwanted_suggestion`, `pressure`) and a short note. Blank means "not rated"; don't guess.
3. **Blinding:** sheets never show the system name, the case ID, DS's expected label or the other rater's order. Raters must not open `key.json`, the fixtures, the code or the report until both sheets are done.
4. Put the filled sheets back at the same paths, then run `node src/evaluation/rate.ts --score` and `node src/evaluation/report.ts --write`. Invalid cells are reported, never repaired. If the fixtures changed after the sheets were generated, the report warns, because the fixture hash is stored in the key.
5. Reported per system: mean usefulness per rater, cases rated unsafe by either or both raters, rater-preferred vs actual outcome, and concerns raised. Also: inter-rater agreement (usefulness exact / within 1, safe κ, preferred κ) and each rater's agreement with the DS labels, which checks the single-annotator labels. The automated metrics (appropriate silence, missed suggestions, unsafe suggestions, forbidden disclosures) are reported separately and are never merged with ratings.

Ratings are synthetic-case evaluation data. Notes must not contain real names or journal text.

