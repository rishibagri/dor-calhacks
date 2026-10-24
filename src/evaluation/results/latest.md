# DS evaluation results

Revision `af2fb9b`, clock `2026-10-24T00:00:00Z`, deterministic (no seed or provider). All inputs are synthetic; policy
decisions come from the offline C6 fake, which is not security evidence. Relevance labels are DS author labels written before
the runs. Teammate 1–5 usefulness ratings have **not** been collected, so no usefulness mean is reported.

## Support-signal baseline (matching.ts), 30 cases
| Metric | Actual |
|---|---|
| Expected outcome reproduced | 29/30 |
| Nudges produced | 8 |
| False nudges (nudge where none expected) | 1 |
| Correct no-action (expected no nudge → no nudge) | 22/23 |

Mismatches:

| Case | Expected | Actual | Note |
|---|---|---|---|
| a3-attack-semantic-signal-id | {"outcome":"no_nudge","reason":"invalid_schema"} | {"outcome":"nudge","templateId":"offer_short_call","supportMode":"short_call"} | known gap |

## Activity ranking, 12 labeled cases (6 positive, 6 no-action)
| Metric | ds_rules_v1 | baseline_soonest_first |
|---|---|---|
| Top-1 relevant (positive cases) | 6/6 | 1/6 |
| Mean precision@3 (positive cases) | 0.78 | 0.36 |
| Missed positives (no suggestion when one was expected) | 0 | 0 |
| Cases with a false suggestion | 0/12 | 9/12 |
| False suggestions (total suggested items) | 0 | 19 |
| Correct no-action | 6/6 | 3/6 |
| No-action with the expected reason | 6/6 | 3/6 |

| Case | ds_rules_v1 | baseline_soonest_first |
|---|---|---|
| ac1-partners-today-no-interests | act-trivia-tonight, act-injection-text, act-drawing-ondemand | act-starts-in-10min, act-trivia-tonight, act-trivia-tonight-dup (**false:** act-starts-in-10min, act-trivia-tonight-dup) |
| ac2-partners-week-mutual-interest | act-movie-watchparty-sat, act-long-ondemand, act-trivia-tonight | act-starts-in-10min, act-trivia-tonight, act-trivia-tonight-dup (**false:** act-starts-in-10min, act-trivia-tonight-dup) |
| ac3-friends-week-one-sided-interests | act-trivia-tonight, act-injection-text, act-board-game-thu | act-starts-in-10min, act-trivia-tonight, act-trivia-tonight-dup (**false:** act-starts-in-10min, act-trivia-tonight-dup) |
| ac4-noaction-no-agreed-option | no_suggestion: no_agreed_option | no_suggestion: no_agreed_option |
| ac5-noaction-short-call-agreed | no_suggestion: not_shared_activity | no_suggestion: not_shared_activity |
| ac6-noaction-empty-catalogue | no_suggestion: empty_catalogue | no_suggestion: empty_catalogue |
| ac7-noaction-only-ineligible-rows | no_suggestion: no_eligible_activity | act-starts-in-10min, act-concert-inperson, act-other-site (**false:** act-starts-in-10min, act-concert-inperson, act-other-site) |
| ac8-noaction-only-weak-rows | no_suggestion: no_strong_match | act-long-ondemand, act-unknown-time (**false:** act-long-ondemand, act-unknown-time) |
| ac9-noaction-nothing-today | no_suggestion: no_eligible_activity | act-movie-watchparty-sat, act-cooking-class-tue, act-board-game-thu (**false:** act-movie-watchparty-sat, act-cooking-class-tue, act-board-game-thu) |
| ac10-friends-support-only-no-window | act-trivia-tonight, act-injection-text, act-board-game-thu | act-starts-in-10min, act-trivia-tonight, act-trivia-tonight-dup (**false:** act-starts-in-10min, act-trivia-tonight-dup) |
| ac11-family-duplicate-listing | act-trivia-tonight | act-trivia-tonight, act-trivia-tonight-dup (**false:** act-trivia-tonight-dup) |
| ac12-partners-today-mutual-games | act-trivia-tonight, act-injection-text, act-drawing-ondemand | act-starts-in-10min, act-trivia-tonight, act-trivia-tonight-dup (**false:** act-starts-in-10min, act-trivia-tonight-dup) |

## Chained: shared_activity nudges from the 30 cases → ds_rules_v1 (no approved interests)
| Support case | Agreed window | Suggestions |
|---|---|---|
| p5-partners-quiz-drafts-neither | — | act-trivia-tonight, act-injection-text, act-board-game-thu |
| f1-friends-support-only-preview | — | act-trivia-tonight, act-injection-text, act-board-game-thu |
