# src/evaluation

DS: quiz mapping fixtures, rule-based matching baseline and the 30-case evaluation set. Shared wire fixtures live in contracts/fixtures; evaluation-specific cases belong here.

Read root AGENTS.md, PRD.md, PROJECT_KNOWLEDGE.md, contracts/README.md and your role/handoff before implementation. Import shared schemas/types from @kinetic/contracts; do not duplicate them.

| File | Purpose | Consumer |
|---|---|---|
| `fixtures/quiz.json` | Quiz mapping spec on the app's `QuizAnswers` keys (Q1–Q8 → `LocalConnectionProfile` / `LocalQuizExtras`) | CS |
| `fixtures/quiz-profiles.json` | 8 full `QuizAnswers` cases with expected `buildProfile` / `buildQuizExtras` output, plus 4 invalid answers | CS |
| `fixtures/evaluation-cases.json` | 30 synthetic cases (6 partners, 6 friends, 6 family, 6 privacy attacks, 6 no-action) with expected preview, policy reason, match/no-nudge and forbidden disclosures | AI, Cyber, CS |
| `matching.ts` | Rule-based baseline: `buildPreview`, `matchSignal`, `intersectAvailability`, `buildNudge` | DS evaluation |
| `__tests__/*.test.ts` | Offline checks over the fixtures and baseline | `npm run test:app` |

Pipeline per case: `buildPreview` (candidate narrowed to the confirmed preset for the named recipient; quiz drafts are never an input) → owner approval → `DisclosurePolicyPort.check` → `matchSignal` (check order in `evaluation-cases.json#matchCheckOrder`) → fixed template nudge or no nudge.

Run: `npm run build && node --test "src/evaluation/__tests__/*.test.ts"` (also part of `npm run check:all`). Policy outcomes use the offline fake from `@kinetic/contracts/fakes`; passing is not security or live-integration evidence. Case `a3` is a `todo` test documenting a known gap (semantic signal IDs), not a pass.
