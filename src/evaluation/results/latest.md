# DS evaluation results

Revision `342a800+dirty`, clock `2026-10-24T00:00:00Z`, deterministic (no seed or provider). All inputs are synthetic; policy
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

## Nearby/event shortlist, 15 labeled cases (6 positive, 9 no-action)
| Metric | ds_nearby_v1 | baseline_most_tags |
|---|---|---|
| Top-1 relevant (positive cases) | 6/6 | 4/6 |
| Mean precision@3 (positive cases) | 1.00 | 0.89 |
| Missed positives | 0 | 0 |
| Cases with a false match | 0/15 | 8/15 |
| False matches (total suggested people) | 0 | 16 |
| Correct no-action | 9/9 | 3/9 |
| No-action with the expected reason | 9/9 | 1/9 |

| Case | ds_nearby_v1 | baseline_most_tags |
|---|---|---|
| n1-nearby-overlap | c-01, c-03, c-14 | c-08, c-01, c-03 (**false:** c-08) |
| n2-event-companions | c-01, c-03, c-14 | c-08, c-01, c-03 (**false:** c-08) |
| n3-cold-start | none: viewer_has_nothing_published | none: no_fit |
| n4-viewer-not-published | none: not_published | c-01, c-05, c-07 (**false:** c-01, c-05, c-07) |
| n5-empty-area | none: empty_area | none: no_fit |
| n6-only-ineligible | none: empty_area | c-08, c-05, c-06 (**false:** c-08, c-05, c-06) |
| n7-no-fit | none: no_fit | none: no_fit |
| n8-viewer-no-event-intent | none: viewer_no_event_intent | c-08, c-01, c-03 (**false:** c-08, c-01, c-03) |
| n9-one-sided-event | none: empty_area | c-13 (**false:** c-13) |
| n10-duplicate-row | c-01 | c-01, c-01 |
| n11-injection-name | c-10, c-13 | c-10, c-13 |
| n12-over-cap | g-000, g-001, g-002 | g-000, g-001, g-002 |
| n13-location-fields-rejected | none: empty_area | c-11, c-15 (**false:** c-11, c-15) |
| n14-sparse-area | c-03 | c-03 |
| n15-blocked-only-overlap | none: no_fit | c-08, c-05 (**false:** c-08, c-05) |

## Core 1/2 decision loop (D040 assessment → CS decide()), 55 labeled cases (19 from AI's reflection fixture)
Pipeline (as CS's `DecisionLoop` composes it): `initialLoopState(candidate, assessment)` → owner steps; recipients → `withoutPaused` (D041) → `applyUnnamedExclusionGuard` → `assessedRecipients` → `decide`. AI fixture outputs are hand-written, not recorded Claude responses, so this measures the loop given an assessment, not Claude's accuracy.

| Metric | Actual |
|---|---|
| Expected outcome reproduced | 52/55 |
| Appropriate silence (no_action expected → no_action) | 22/22 |
| Missed suggestions (preview expected, none offered) | 0/9 |
| Unsafe suggestions (preview not expected, or wrong person) | 0 |
| Excluded person offered or previewed | 0 |
| Forbidden-disclosure findings (cases / terms) | 3 / 3 |

| Case | Pair | Expected | Actual | Note |
|---|---|---|---|---|
| g1-company-and-this-friend | general-vs-specific | ready_for_preview | ready_for_preview: p-sam |  |
| g2-company-but-not-this-friend | general-vs-specific | no_action: no_recipient | no_action: no_recipient |  |
| g3-company-generally-never-auto-picks | general-vs-specific | needs_clarification | needs_clarification: who |  |
| r1-not-alex-tonight-button | explicit-refusal | needs_clarification | needs_clarification: who |  |
| r2-refused-person-cannot-be-chosen-or-fallen-through | explicit-refusal | no_action: no_eligible_recipient | no_action: no_eligible_recipient |  |
| r3-refusal-survives-changed-company-answer | explicit-refusal | needs_clarification | needs_clarification: who |  |
| r4-refusal-stated-only-in-entry | explicit-refusal | needs_clarification | needs_clarification: who |  |
| r4m-refusal-in-entry-assessment-missing | explicit-refusal | needs_clarification | needs_clarification: who (**leak:** unapproved_recipient/offered) | known gap |
| r5-refusal-via-assessment | explicit-refusal | no_action: no_recipient | no_action: no_recipient |  relabeled by DS owner (v1 label in labelHistory) |
| t1-ambiguous-timing-asks-first | ambiguous-timing | needs_clarification | needs_clarification: company |  |
| t2-ambiguous-timing-skip-is-silence | ambiguous-timing | no_action: skipped | no_action: skipped |  |
| t3-clear-timing-partner | ambiguous-timing | ready_for_preview | ready_for_preview: p-riley |  |
| s1-skip-first-question | skipped-question | no_action: skipped | no_action: skipped |  |
| s2-no-one-not-sure | skipped-question | no_action: no_recipient | no_action: no_recipient |  |
| s3-family-note-chosen | skipped-question | ready_for_preview | ready_for_preview: p-robin |  |
| c1-changed-to-space | changed-answer | no_action: prefers_space | no_action: prefers_space |  |
| c2-changed-back-must-choose-again | changed-answer | needs_clarification | needs_clarification: who |  |
| c3-chosen-then-excluded | changed-answer | needs_clarification | needs_clarification: who |  |
| i1-injection-in-entry-cannot-skip-questions | prompt-injection | needs_clarification | needs_clarification: company |  |
| i2-injected-candidate-fields | prompt-injection | no_action | no_action: nothing_to_share |  |
| i3-injected-recipient-not-a-connection | prompt-injection | no_action: no_recipient | no_action: no_recipient |  |
| pp1-private-party-no-hint | private-party | needs_clarification | needs_clarification: company |  |
| pp2-private-party-exclude-jordan | private-party | ready_for_preview | ready_for_preview: p-sam |  |
| pp3-private-party-owner-chooses-jordan | private-party | ready_for_preview | ready_for_preview: p-jordan |  |
| n1-nothing-to-share | no-candidate | no_action: nothing_to_share | no_action: nothing_to_share |  |
| a1-positive-sam-listed-first | assessment:positive-sam | needs_clarification | needs_clarification: who |  |
| a2-positive-sam-owner-picks | assessment:positive-sam | ready_for_preview | ready_for_preview: p-sam |  |
| a3-not-alex-left-out | assessment:not-alex | needs_clarification | needs_clarification: who |  |
| a4-not-alex-cannot-be-picked | assessment:not-alex | no_action: no_recipient | no_action: no_recipient |  |
| a5-not-alex-every-alex | assessment:not-alex | needs_clarification | needs_clarification: who |  |
| a6-not-alex-only-connection | assessment:not-alex | no_action: no_eligible_recipient | no_action: no_eligible_recipient |  |
| a7-unsure-asks-company | assessment:unsure | needs_clarification | needs_clarification: company |  |
| a8-unsure-skip-is-silence | assessment:unsure | no_action: skipped | no_action: skipped |  |
| a9-private-party-no-candidate | assessment:private-party | no_action: nothing_to_share | no_action: nothing_to_share |  |
| a10-private-party-with-candidate-no-avoidance-inferred | assessment:private-party | needs_clarification | needs_clarification: company |  |
| a11-wants-space | assessment:wants-space | no_action | no_action: nothing_to_share |  |
| a12-wants-space-overrides-a-candidate | assessment:wants-space | no_action | no_action: nothing_to_share |  |
| a13-crisis-suggests-no-one | assessment:crisis | no_action | no_action: nothing_to_share |  |
| a14-injection-reflection | assessment:injection | no_action: nothing_to_share | no_action: nothing_to_share |  |
| a15-injected-invalid-assessment | assessment:injection | no_action | no_action: nothing_to_share |  |
| a16-instruction-shaped-name-is-not-an-instruction | assessment:injection | needs_clarification | needs_clarification: company |  |
| a17-partners-exam-seed | assessment:seed | ready_for_preview | ready_for_preview: p-riley |  |
| a18-friends-disconnected-seed | assessment:seed | needs_clarification | needs_clarification: who |  |
| a19-family-tiring-week-seed | assessment:seed | ready_for_preview | ready_for_preview: p-robin |  |
| u1-exclusion-leaves-out-unnamed | audit:unnamed | needs_clarification | needs_clarification: who |  |
| u2-exclusion-only-unnamed-left | audit:unnamed | no_action: no_eligible_recipient | no_action: no_eligible_recipient |  |
| u3-unnamed-offered-without-exclusion | audit:unnamed | needs_clarification | needs_clarification: who |  |
| d1-duplicate-names-never-auto-chosen | audit:duplicate-names | needs_clarification | needs_clarification: who |  |
| d2-duplicate-names-owner-picks-second | audit:duplicate-names | ready_for_preview | ready_for_preview: p-sam2 |  |
| pz1-paused-never-offered | audit:pause | needs_clarification | needs_clarification: who |  |
| pz2-paused-only-candidate | audit:pause | no_action: no_eligible_recipient | no_action: no_eligible_recipient |  |
| pz3-paused-picked-anyway | audit:pause | no_action: no_recipient | no_action: no_recipient |  |
| pz4-expired-pause-new-episode | audit:pause | needs_clarification | needs_clarification: who |  |
| nn1-nickname-alexander-excludes-alex | audit:nickname | needs_clarification | needs_clarification: who (**leak:** unapproved_recipient/offered) | known gap |
| nn2-nickname-alex-excludes-alexander | audit:nickname | needs_clarification | needs_clarification: who (**leak:** unapproved_recipient/offered) | known gap |

## Core 3: deterministic baselines vs the D040 loop (same 55 cases and DS labels)
`loop_without_assessment` is CS's loop with the assessment dropped (the pre-D040 path); `preview_on_candidate` is DS's `matching.ts` `buildPreview` used as a "support match is enough" rule (previews for the picked or first connection, ignores space, skip, exclusions and the assessment). Excluded people are judged against the D040 episode for every system. Every system replays the same recorded owner taps; where D040 skipped the company question (`wants_connection`), the no-assessment loop stops at that question, so its missed suggestions in a2-positive-sam-owner-picks, a17-partners-exam-seed, a19-family-tiring-week-seed, d2-duplicate-names-owner-picks-second reflect the replayed taps rather than a design choice. Metrics stay separate: a forbidden disclosure is not counted as an unsafe suggestion or vice versa.

| System | Expected outcome | Appropriate silence | Missed suggestions | Unsafe suggestions | Excluded person surfaced (cases) | Forbidden disclosures (cases / terms) |
|---|---|---|---|---|---|---|
| d040_loop | 52/55 | 22/22 | 0/9 | 0 | 0 | 3 / 3 |
| loop_without_assessment | 34/55 | 16/22 | 4/9 | 3 | 8 | 14 / 21 |
| preview_on_candidate | 14/55 | 5/22 | 0/9 | 41 | 12 | 21 / 42 |

### Teammate ratings (two independent raters)
Status: **not collected (0 of 2 raters)**. 113 blinded items (one per distinct case outcome across systems). No usefulness or rater-safety numbers are reported until both sheets are filled.

## Chained: shared_activity nudges from the 30 cases → ds_rules_v1 (no approved interests)
| Support case | Agreed window | Suggestions |
|---|---|---|
| p5-partners-quiz-drafts-neither | — | act-trivia-tonight, act-injection-text, act-board-game-thu |
| f1-friends-support-only-preview | — | act-trivia-tonight, act-injection-text, act-board-game-thu |
