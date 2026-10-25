# Core 4 evaluation summary (DS)

Fixture hash `df0ddee38e19d06e`, decision clock `2026-10-24T18:00:00Z`, support clock `2026-10-24T00:00:00Z`. Deterministic and offline: no provider, worker, reducer or live database ran, and policy decisions come from the C6 fake (not security evidence). Regenerate with `node src/evaluation/core4.ts --write`; `--check` fails if this file is stale.

## Sample size (real counts)

| | Cases |
|---|---|
| Core 4 examples (this summary) | **19** (14 decision-loop, 5 support-signal) |
| Synthetic | 19 of 19 (no real people, journals or recorded model outputs) |
| Reused from Core 1–3 | 19 of 19: every example is an existing labeled case, referenced by ID; none is new or relabeled here |
| Reused across suites | 5 decision examples take their story, candidate and assessment from AI's `reflection.synthetic.json` by reference (a17-partners-exam-seed ← partners-exam, a8-unsure-skip-is-silence ← unsure, a12-wants-space-overrides-a-candidate ← wants-space, a19-family-tiring-week-seed ← family-tiring-week, a9-private-party-no-candidate ← private-party); AI's own assessment and adapter tests use the same fixture. 14 of 14 decision examples also appear in the blinded Core 3 rater sheets (`results/ratings/key.json`). |
| Full DS sets they come from | 55 decision-loop cases (19 referencing 10 AI reflection cases) + 30 support-signal cases = 85 labeled synthetic cases |
| Relationships | partners 6, friends 10, family 3 (private-party cases are friends) |
| Coverage | positive 4, explicit_refusal 4, uncertainty 4, recipient_specific_permission 5, correct_silence 11, private_party 3 |

## Results

Expected outcome reproduced: **19/19**. Privacy checks held: **50/50**. Known gaps among the examples: none.

| Case | Suite | Relationship | Covers | Expected (source label) | Actual | Privacy checks | Recipient would see |
|---|---|---|---|---|---|---|---|
| a17-partners-exam-seed | decision | partners | positive | ready_for_preview: p-riley | ready_for_preview: p-riley | 4/4 | "Someone you are connected with would welcome a short call. Want to offer one?" |
| t1-ambiguous-timing-asks-first | decision | partners | uncertainty | needs_clarification: company [p-riley] | needs_clarification: company [p-riley] | 3/3 | nothing |
| a8-unsure-skip-is-silence | decision | partners | uncertainty, correct_silence | no_action: skipped | no_action: skipped | 3/3 | nothing |
| g1-company-and-this-friend | decision | friends | positive, recipient_specific_permission | ready_for_preview: p-sam | ready_for_preview: p-sam | 4/4 | "Someone you are connected with would welcome a short call. Want to offer one?" |
| g2-company-but-not-this-friend | decision | friends | recipient_specific_permission, correct_silence | no_action: no_recipient | no_action: no_recipient | 3/3 | nothing |
| r4-refusal-stated-only-in-entry | decision | friends | explicit_refusal | needs_clarification: who [p-sam] | needs_clarification: who [p-sam] | 3/3 | nothing |
| r2-refused-person-cannot-be-chosen-or-fallen-through | decision | friends | explicit_refusal, correct_silence | no_action: no_eligible_recipient | no_action: no_eligible_recipient | 3/3 | nothing |
| pz3-paused-picked-anyway | decision | friends | explicit_refusal, correct_silence | no_action: no_recipient | no_action: no_recipient | 3/3 | nothing |
| a12-wants-space-overrides-a-candidate | decision | friends | correct_silence | no_action | no_action: nothing_to_share | 3/3 | nothing |
| a19-family-tiring-week-seed | decision | family | positive | ready_for_preview: p-robin | ready_for_preview: p-robin | 4/4 | "Someone you are connected with would welcome a kind note. Want to send one?" |
| s1-skip-first-question | decision | family | uncertainty, correct_silence | no_action: skipped | no_action: skipped | 3/3 | nothing |
| a9-private-party-no-candidate | decision | friends | private_party, correct_silence | no_action: nothing_to_share | no_action: nothing_to_share | 3/3 | nothing |
| pp1-private-party-no-hint | decision | friends | private_party, uncertainty | no_action: nothing_to_share | no_action: nothing_to_share | 3/3 | nothing |
| pp2-private-party-exclude-jordan | decision | friends | private_party, explicit_refusal, recipient_specific_permission | no_action: nothing_to_share | no_action: nothing_to_share | 3/3 | nothing |
| p1-partners-call-this-week | support | partners | positive | nudge: offer_short_call | nudge: offer_short_call | 1/1 | "Someone you are connected with would welcome a short call. Want to offer one?" |
| p4-partners-recipient-declines | support | partners | recipient_specific_permission, correct_silence | no_nudge: recipient_declined | no_nudge: recipient_declined | 1/1 | nothing |
| f6-friends-new-recipient-no-inherited-access | support | friends | recipient_specific_permission, correct_silence | no_nudge: wrong_recipient | no_nudge: wrong_recipient | 1/1 | nothing |
| fa6-family-recipient-not-opted-in | support | family | correct_silence | no_nudge: no_recipient_consent | no_nudge: no_recipient_consent | 1/1 | nothing |
| n1-noaction-revoked | support | partners | correct_silence | no_nudge: revoked | no_nudge: revoked | 1/1 | nothing |

## README "Core definition of done", offline evidence

- **useful approved nudge:** a17-partners-exam-seed, a19-family-tiring-week-seed, p1-partners-call-this-week: reproduced offline.
- **clarification stays private:** t1-ambiguous-timing-asks-first, pp1-private-party-no-hint: reproduced offline.
- **refusal cannot deliver:** r2-refused-person-cannot-be-chosen-or-fallen-through, pz3-paused-picked-anyway: reproduced offline.
- **revoked signal no new nudge:** n1-noaction-revoked: reproduced offline.

Why each case was chosen:

- `a17-partners-exam-seed`: AI seed reflection (partners-exam) by reference: Claude's assessment wants connection, the owner picks Riley, an exact preview is shown.
- `t1-ambiguous-timing-asks-first`: Unclear timing: one neutral private question about the owner's wishes; nothing recipient-visible.
- `a8-unsure-skip-is-silence`: AI 'unsure' reflection: the owner skips the question, and skipping means silence, not an optimistic fallback.
- `g1-company-and-this-friend`: Paired with g2: the same candidate and the same general wish for company; this entry is about Sam, so Sam is previewed.
- `g2-company-but-not-this-friend`: Paired with g1: wanting company is not wanting this friend; the owner picks no one, so nothing happens.
- `r4-refusal-stated-only-in-entry`: README example 'I want company, but not Alex tonight': the assessment leaves Alex out without asking for a reason; only Sam is offered.
- `r2-refused-person-cannot-be-chosen-or-fallen-through`: The refused person cannot be chosen, and nobody else is substituted automatically.
- `pz3-paused-picked-anyway`: D041 durable pause: even when the owner taps the paused person, the episode ends in silence.
- `a12-wants-space-overrides-a-candidate`: AI 'wants space' reflection: a usable support candidate exists, but the entry asks for space, so nothing is offered.
- `a19-family-tiring-week-seed`: AI seed reflection (family-tiring-week) by reference: the owner picks Robin, an exact preview is shown.
- `s1-skip-first-question`: Family entry where the owner skips the first question: no action.
- `a9-private-party-no-candidate`: README private-party no-action case (AI reflection private-party): no question about Friday night, no activity hint, no excuse, nothing shared.
- `pp1-private-party-no-hint`: Private party with a support candidate: only the neutral company question is asked; nothing about the party, Jordan or the declined invitation.
- `pp2-private-party-exclude-jordan`: The owner leaves Jordan out and chooses Sam; Sam's preview carries no party, location or tension term.
- `p1-partners-call-this-week`: Seed journey after approval: preset allows it, the owner approves, the recipient agrees, a fixed-template nudge is built; the exam story never crosses.
- `p4-partners-recipient-declines`: The recipient's own preferences decline: no nudge and no follow-up probing.
- `f6-friends-new-recipient-no-inherited-access`: A second friend has no preset assignment: one person's permission does not carry over to another on the same preset kind.
- `fa6-family-recipient-not-opted-in`: The family recipient has not opted in, so no ACK and no nudge; nothing hints back to the sender.
- `n1-noaction-revoked`: The owner revoked the approval before coordination: no nudge.

## Privacy checks applied

- Decision-loop cases: no forbidden-disclosure term (unapproved recipient, private activity, location, excuse, relationship tension, timing detail) on any owner, recipient or offered surface; no excluded or paused person offered or previewed; no preview for a person the owner did not choose. (That recipient-visible copy appears only at a preview holds by construction here and is asserted on every screen of every case in `decision-loop.test.ts`.) For previews, the nudge after a *simulated* approval is fixed template copy with no story term.
- Support-signal cases: no forbidden story term in anything that crosses to the recipient side (preview, envelope, ACK, nudge). The expected outcome itself encodes the delivery gate (policy, recipient consent, ACK); the release-bar tests of the 30-case suite cover that no revoked, expired, unlinked, attack or no-action case produces a nudge.
- Each check above has a negative control in `__tests__/core4.test.ts` (a deliberately leaking variant or a baseline system) that must make it fail, so a clean result is not vacuous.

## Limitations

- 19 examples is a small, hand-picked sample chosen to cover the README categories; the rates above describe these cases, not a population.
- Every case is synthetic. Labels come from one DS annotator, written before the Core 1–3 runs; teammate ratings have **not** been collected.
- AI's reflection outputs are hand-written fixtures, not recorded Claude responses, so this measures the loop given an assessment, not Claude's accuracy.
- "Approval" for decision-loop previews is simulated (fixed consent, no quiet hours, no cooldown); support cases use the C6 fake policy. No reducer, worker, Droid, Clerk session or SpacetimeDB host ran, so nothing here is live or deployed evidence.
- Not covered here: timing and batching of live delivery (DS mirrors the D043 `my_nudges` row in `matching.ts` `recipientNudgeRow`, offline only; it reveals the approval hour, an accepted D043 residual reported by the DS owner, and hides the exact approval minute), browser UI copy, microphone/provider failures.
