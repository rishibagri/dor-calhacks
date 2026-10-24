# Recipient exclusion and pause: Core 1 boundary proposal (Cyber, D040)

**Status: PROPOSED for review by CS (producer of UI/plumbing), Adam (assessment and worker) and Nimisha (evaluation).** Reference guards exist in `contracts/src/recipient-pause.ts` with 7 tests. Nothing uses them yet: there's no table, reducer, view, worker change or UI, and no existing wire type changes until the review lands (Core 2). README "Reasoning layer" items 2, 5 and 7 and the "Temporary boundaries" requirement are the source.

## 1. Two restrictions, both narrowing only

| | Episode exclusion | Recipient pause |
|---|---|---|
| What the owner says | "I want company, but not Alex tonight." | "Pause sharing with Alex until …" |
| Where it lives | **This device only**, for the current private decision. Discarded on completion, cancel, lock or account change (README data lifetime). | One private server row per owner + pair (proposed `recipient_pause`). |
| Who creates it | The private assessment may mark it automatically (a veto narrows, so it's safe), or the owner can. | **Only an explicit owner tap.** A model, a clarification answer or the worker can suggest it, never set or lift it. |
| Effect | The device never offers Alex a preview in this episode. Nothing is sent anywhere. | Refuses new approvals to Alex. Revokes every standing approval to Alex in that pair and suppresses their nudges, in the same transaction. |
| Scope | One episode | 15 minutes to 30 days, always with an end. Permanent separation is unlink, which already exists. |
| Ends | With the episode | At expiry, or when the owner resumes early. **Ending restores nothing**: any new sharing needs a fresh preview and approval. |
| Stored reason | None | None. There is no reason or free-text field in the schema. |

Neither restriction can broaden a preset, create consent, or choose another recipient. "Not Alex" never means "so tell Jo instead."

**Escalation rule:** if the owner excludes someone for an episode while a standing approval to that person exists, the episode exclusion alone can't stop it, because the approval is already on the server. The device must then offer a pause, defaulting to the rest of the episode, never longer, or a revoke of that approval. It must not silently leave the approval live.

## 2. Proposed record (Core 2, after ACK)
`recipient_pause { pause_id (opaque), owner, target, pair_id, version u32, expires_at, resumed_at?, created_at }`
- `target` is derived from the pair (the other member) and never taken from the request (`guardPauseRequest`). A pause can't name a stranger or probe identities.
- There is one current row per owner + pair. Set, extend and resume all bump `version`.
- Private table. The only view is owner-only `my_recipient_pauses` with `{pair_id, expires_at, active}`; the client shows the name from `my_pairs`.

## 3. Transitions (proposed reducer names)
| Reducer | Caller | Checks | Effects |
|---|---|---|---|
| `pause_recipient({pair_id, expires_at, expected_version})` | pair member | accepted pair; 15 min ≤ duration ≤ 30 days; optimistic version | upsert pause; **revoke** every standing approved signal owner → target in the pair; **suppress** every nudge derived from them (`pauseInvalidates`); sender-only receipts record `revoked` |
| `resume_recipient({pair_id})` | owner | owns an active pause | end it now, bump version; restores nothing |
| sweep | internal | — | mark lapsed pauses; restores nothing |

Idempotent: pausing an already-paused person with a later expiry extends it. Unlink ends any pause between the two.

## 4. Where it is enforced (commit-time semantics)
`guardNotPaused(pauses, ownerId, recipientId, pairId, nowMs)` is added to three places, re-reading authoritative rows in the same transaction:

1. **Approval:** `approve_signal`, after membership and before anything else, so an excluded recipient can't be approved.
2. **Use:** `guardSignalUse` / `guardSignalStanding`, in the worker policy, `worker_signal_context` and `my_nudges`.
3. **Commit:** `commit_nudge`, for the owner of each source signal.

Together these cover the README's "Change of mind" case. Generation that is already running when the owner pauses is refused at commit. An old retry or reconnect finds the source approval revoked. A later clarification or the pause's expiry can't restore it, because revocation is permanent and each new approval is a new row.

**Refusal reason:** the refusal is the existing `revoked`, not a new `paused`. The worker, its ledger, outcome codes and logs therefore can't tell a pause from an ordinary revocation, and pause metadata never leaves the owner.

The same rule applies to the extensions in Core 2:
- C7 `approve_activity_interest` is refused.
- Standing activity approvals are revoked.
- Pair-based plans go stale through their approvals.

Discovery introductions are a separate consent and aren't affected; blocking is the tool there.

## 5. Recipient-visible surfaces (indirect disclosure review)
| Surface | What the target can observe | Decision |
|---|---|---|
| `my_pairs`, account, presets | Nothing changes | ✓ |
| A nudge they have **not** seen yet | Never appears | ✓ |
| A nudge they **already** saw | It disappears, the same as today's revoke | Residual inference risk, unavoidable: keeping it visible would continue a withdrawn disclosure. The owner's pause copy must say so. |
| Future nudges | None from this owner until a fresh approval | ✓ Indistinguishable from the owner simply not sharing |
| Cooldown / quiet-hours timing | Suppressed nudges still count toward the 24 h pair cooldown | ✓ No timing signal is added |
| Receipts | Sender-only already | ✓ |
| Worker / peer agent / Factory session | Sees approvals disappear (revoked), never "paused" or any reason | ✓ |
| Badges, counts, notification titles (CS) | Must not change in any way that differs from an ordinary revoke | **CS to confirm** in the clarification/pause UI review |

## 6. Owner-side copy (proposed; CS to place)
- Pause: "Pause sharing with {name} until {time}? Anything you've already shared with {name} is withdrawn now. If they've already seen a nudge, it will disappear. {name} isn't told, and dor won't suggest anyone else instead."
- Active state: "Sharing with {name} is paused until {time}. [Resume now]". Resuming doesn't re-share anything.
- Never ask for a reason. Never show the pause to anyone else.

## 7. What each owner needs to review (Core 1)
- **CS:**
  - The reducer and view names in §2–§3.
  - The escalation rule in §1.
  - The §5 badge/count rows.
  - The §6 copy.
  - Episode state cleared on lock/account switch, as with the share candidate.
- **Adam:**
  - The private assessment may emit device-only `excludedRecipients` (vetoes) and may *suggest* a pause. It never sets or lifts one, and none of it enters the worker request, peer prompts or logs.
  - The worker treats `revoked` from commit as no nudge, as it already does.
  - The safe-template fallback must not bypass an episode exclusion: the excluded recipient is never offered.
- **Nimisha:** add the §8 cases as no-action evals. Paired fixtures: same availability, Alex excluded vs Jo not.

## 8. Rejection cases Core 2 must prove (direct reducer/view tests)
1. Approving for a paused recipient is refused.
2. Pausing while generation is running: commit is refused, and no nudge is visible.
3. A worker replay after the pause is refused.
4. Approvals revoked by a pause stay revoked after expiry and after resume. A fresh approval after expiry works.
5. A pause by Sam on Alex doesn't affect Sam → Jo, or Alex → Sam.
6. A third account can't pause, resume or see a pause.
7. The target's views show no difference beyond the disappearance of an already-seen nudge.
8. No pause field reaches a worker view, a peer prompt, the ledger or a log.
9. A model output or clarification answer alone never creates, extends or lifts a pause.
10. An episode exclusion is never sent to the server.

## 9. Proposed file claims (Core 2)
- **Cyber:**
  - `contracts/src/recipient-pause.ts`
  - the `recipient_pause` table and reducers (new `spacetimedb/src/reducers/pause.ts`)
  - pause checks in `policy.ts` guards, `reducers/signals.ts`, `reducers/coordination.ts` and `views.ts`
  - the sweep rule
  - the owner pause control model in `src/features/privacy/`
- **CS:** pause UI placement, the episode exclusion in the journal and share review, bindings.
- **Adam:** the assessment's device-only exclusions.
- **Nimisha:** the eval cases.

## 10. Open questions for review
- Default pause length offered first: "rest of tonight" (device computes local 6 am) or 24 h?
- Should a pause also hide the owner from the target's **discovery** cards? Proposed **no**: discovery is a separate public consent and blocking already exists. Hiding would be a visible change.
- Is 30 days the right ceiling, with unlink beyond it?
