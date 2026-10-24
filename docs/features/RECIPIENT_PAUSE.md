# Recipient pause — requirements for the Cyber contract

**Owner of the design and implementation:** Sumedh (Cyber). **Requested by:** Adam (AI) and CS, for README Core 2. **Status:** **implemented offline (D041)** on `role/cyber-privacy`; not published or live-verified. Exact names are below under "As implemented". This page says what must hold and what other roles will consume. Sumedh chooses the schema, reducer and view names, and documents any deviation here.

## As implemented (D041, Cyber)

| Piece | Name / shape |
|---|---|
| Table (private) | `recipient_pause {pause_id, owner (btree), pair_id, target, version u32, expires_at, resumed_at?, created_at, updated_at}`. One row per owner + pair. No reason or text field. |
| Set / extend | `pause_recipient({pair_id: string, expires_at: ISO string, expected_version: u32})`. Pair member only; 15 min ≤ duration ≤ 30 days; `expected_version` = current `version` (0 for none). Revokes the owner's standing approvals in the pair, suppresses their nudges and revokes the owner's C7 activity approvals there. |
| Resume | `resume_recipient({pair_id: string, expected_version: u32})`. Owner only; restores nothing. |
| Owner view | `my_recipient_pauses → {pair_id, version, expires_at, active: bool, created_at}[]`. Join `pair_id` to `my_pairs` for the name. |
| Errors (owner) | `not_found: pair`, `invalid: too_long` / `too_short` / `invalid_schema` / `pair_not_accepted`, `stale: pause version changed`, `not_found: pause` (resume with none); `approve_signal` while paused → `unauthorized: recipient_paused`. |
| Worker | **Preferred design, no worker change.** Paused pairs' signals are absent from `worker_signal_context`; `commit_nudge` refuses a late pause with the same `stale: revoked` as a revoked approval, which `classifyCommitError` treats as `policy_denied`. No new worker-visible field. |
| Expiry | `sweep_expired` marks lapsed pauses (`expired_record` key `pause:<id>:<version>`); views treat an unmarked lapsed pause as in force (fail closed) for at most one sweep interval. |

Tests: `spacetimedb/tests/pause.test.ts` (19). Contract guards: `contracts/src/recipient-pause.ts` with `contracts/tests/recipient-pause.test.mjs` (7).

## Why

The README core requirements ("Temporary boundaries are respected", "Atomic delivery", reasoning step 7) need a **durable, person-specific** "not this person for now". It must hold across sessions and block delivery on the server. Today two partial pieces exist:
- the client-only, one-episode exclusion in the [decision loop](PRIVATE_DECISION_LOOP.md);
- Claude's [private assessment](PRIVATE_ASSESSMENT.md) exclusions, which feed that client-only exclusion.

Neither stops an already-approved signal or a queued worker job. A pause must.

## Must hold

1. **Owner-only, explicit, reason-free.** Only the owner creates, edits or clears a pause, for one counterpart in one accepted pair. Store no reason, note, journal text or model output. Allowed fields are the minimum: pair, counterpart, created/expiry time, version.
2. **Scoped duration.** The owner sees who is paused and until when: an end time, or until resumed, with a bounded maximum (Cyber decides). Pausing never auto-selects someone else.
3. **Blocks at every point:**
   - **approval:** `approve_signal` to a paused counterpart is refused;
   - **worker read:** `worker_signal_context` (and `worker_support_preferences` if relevant) must not present that pair's signals as usable;
   - **commit:** `commit_nudge` refuses in its own transaction;
   - **visibility:** `my_nudges` hides already-committed nudges derived from signals the owner has since paused.
4. **No resurrection.** Resuming, an expiring pause, a retry, a reconnect or a later clarification answer must not make a signal or job from **before** the pause usable again. New sharing needs a fresh preview and approval. One option: pausing revokes or invalidates that pair's standing approved signals, or bumps a version the guards bind.
5. **Silent to the counterpart.** No receipt, badge, error, timing difference or view row tells the paused person anything. Refusals the counterpart could observe must be indistinguishable from "nothing was sent" (no oracle).
6. **Fail closed.** If the pause state is unreadable or ambiguous, the result is "no delivery".

## What AI consumes (Adam)

- **Preferred:** paused pairs' signals simply drop out of `worker_signal_context`, and `commit_nudge` rechecks the pause. Then the worker needs **no code change**:
  - `SpacetimePolicyStateReader` returns null, so `DisclosurePolicy` denies.
  - `BoundedCoordinator` rechecks policy after the model runs and before the fixed-template fallback commits, so a pause during generation becomes `policy_denied`.
  - `commit_nudge` refusing a late pause is classified as `policy_denied` by `classifyCommitError`.
- If you instead add a field to worker rows (for example `pause_version`), tell Adam the exact name and type. The worker will bind and recheck it, and the commit args will carry it.
- AI will add integration cases in `worker/integration/` once the reducers exist: pause before the job, pause during generation, pause then resume (the old signal stays dead), and the fallback path.

## What CS consumes

- Owner reducers to set and clear a pause, plus an owner-only view listing their own pauses (counterpart and end time). CS adds pause/resume controls in Connections and Privacy, and shows the end time.
- Copy rules: no reason prompt, and no "they will/won't be told" promises beyond "they are not notified".

## Build on CS's index work (PR #30)

#30 adds btree indexes on owner, sender, recipient and pair columns, plus a `pair_member` lookup table, and moves per-user views and hot reducers to index ranges.
- Do pause lookups in `approve_signal`, `commit_nudge`, `my_nudges` and other per-user views the same way: by owner/pair index, with **no new whole-table scans**.
- Worker-only views and the expiry sweep may scan, as #30 documents.
- If #30 is not merged when you start, merge main again after it lands, before opening your PR.
- CI on main runs `check:all`, the schema drift check, `ai:check` and `next build`.

## Tests expected (Cyber)

Direct reducer and view calls with a third account, in the style of `spacetimedb/tests/*.test.ts`:
- only the owner can pause;
- the counterpart and a third account cannot read or detect it;
- approval is refused while paused;
- pause between approval and worker commit → no nudge;
- resume does not revive pre-pause signals or jobs;
- expiry is handled by the sweep;
- block, unlink and pause interact safely;
- mutation checks for each guard.

## Not in scope

Discovery or introductions blocking (already covered by D038 blocks), group pauses, inferring pauses from journals or assessments, and any server copy of the client-only episode exclusion.
