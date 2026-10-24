# Core 3 live smoke + CS audit — forwardable messages (2026-10-24)

Drafts for the user to forward. Nothing here was sent to anyone. Evidence and file:line detail are in `docs/handoffs/cs.md` ("Core 3 live smoke + CS logic audit"). The CS PR is #35. The CS pause controls are on branch `role/cs-pause-controls`, stacked on PR #34.

**What happened, for everyone:**
- CS ran the first real live check of the core path. It used real Clerk dev JWTs against a local SpacetimeDB (`dor-local`, module `dor`) and `scripts/smoke-core3.ts`, and **26/26 checks passed**. Steps covered:
  - two accounts pair up
  - the owner approves with the app-identical `payloadRevision`
  - signals and receipts are sender-only
  - a third account is refused on accept, approve and revoke, and sees zero rows in 9 views
  - a wrong revision is refused
  - revoke and replay do not resurrect the signal
  - reconnect works
  - a garbage token and an anonymous connection are refused
- Not verified live:
  - nudge delivery (worker / `commit_nudge` / Droid)
  - the browser UI path
  - pause cases
  - Claude and Cartesia
- Please don't describe Core 3 as "live verified". Describe it as "partial live smoke".

---

## Sumedh (Cyber)

Hi Sumedh. CS findings that land in your area, highest first. Each item gives the exact location and a proposed fix. Your call on design.

1. **Scheduler auth (overlap with your #34).** CS hit the same live bug: `sweep_expired: unauthorized: scheduler only` every 60 s on a real 2.13 host. CS drafted an identical fix (`isScheduledCall`). Your `isDatabaseInternal` in #34 is the same logic, so **CS dropped its copy from PR #35 and defers to yours**. Live evidence you can cite for it:
   - Republishing the same predicate at 19:07:58Z stopped the error. The last failure was 19:03:23Z, and there were no errors across the following ticks.
   - CS also ran a positive marking check with an expiring support preference. It is behind `--sweep` in `scripts/smoke-core3.ts`; the result is in the CS handoff.
   - Please merge #34 soon. Until then, main's sweep is broken on any real host, so views never hide expired rows.

2. **HIGH: `my_nudges` leaks timing to the recipient** (`spacetimedb/src/views.ts` ~145, `t.array(nudge.rowType)`).
   - The recipient's client receives the full row: `created_at`, `expires_at`, `source_signal_ids`, `source_consent_versions`, `recipient_consent_id` and `pair_id`.
   - `expires_at = min(approval + SIGNAL_LIFETIME_MS, preset expiry)` (`contracts/src/policy.ts` ~269), so `expires_at − lifetime` is the sender's exact approval moment, and `created_at` is the commit moment. Both sit close to when the sender journaled.
   - The UI renders only `id` and `template_id`, but a raw subscription sees everything.
   - Proposed fix: a narrow view row `{ id, template_id, pair_id, visible_until }`, with `visible_until` coarsened (e.g. to the hour or the day) and no signal or consent ids. CS will update `mappers.ts` / the nudges page the same day; tell us the row shape.

3. **HIGH: sender receipts reveal recipient-side state** (`views.ts` ~161 `my_receipts`, `reducers/coordination.ts` ~70, `suppress.ts`, shown in `src/app/privacy/page.tsx` ~62).
   - The sender sees the actions `used` and `suppressed`. "Approved but never used" implies the recipient is not opted in, is in quiet hours or cooldown, or has not accepted that support mode. "Suppressed" implies the recipient changed settings or revoked consent. This is indirect disclosure in the recipient → sender direction.
   - Proposed fix: `my_receipts` shows the sender only their own actions (`approved`, `revoked`, `expired`). Recipient-caused outcomes collapse into no row change. CS will drop the "Suppressed for …" copy once the view changes.
   - This is also a product call; Rishi agrees it should be closed.

4. **MEDIUM: reason code.** A wrong `payloadRevision` is refused as `unauthorized: no_consent`, not `stale_policy`. It is still refused. Is that intended? DS evals assert reason codes.

5. **MEDIUM: `requireOwner` (`admin.ts` ~16) still falls back to `isInternal`.** Your #34 already fixes `requireIngester`. Please confirm that the owner path relies only on the `module_owner` row live, and update the comment.

6. **D041: CS controls are ready, stacked on #34** (branch `role/cs-pause-controls`). They consume:
   - `pause_recipient({pair_id, expires_at, expected_version})`
   - `resume_recipient({pair_id, expected_version})`
   - `my_recipient_pauses` rows `{pair_id, version, expires_at, active, created_at}`

   Please confirm:
   - (a) the `expires_at` string format and the max duration
   - (b) `expected_version` on the first pause (0?)
   - (c) that the paused person sees no change in any view: no receipt, and no row disappearing from their side

   CS will retarget that PR to main as soon as #34 merges. Any rename on your side breaks it, so ping first.

7. **Merge note.** #34 touches `guards.ts`, `expiry.ts`, `signals.ts`, `coordination.ts` and `views.ts`. PR #35 no longer touches any module source. Its only module-adjacent change is a new `npm run bindings:check` plus a CI job that fails if the committed bindings drift from `spacetimedb/src`. **After #34, regenerate both binding dirs** (`src/lib/spacetime/module_bindings`, `worker/src/module_bindings`), or CI will go red.

---

## Adam (AI)

Hi Adam. Here's what touches the worker and the assessment.

1. **HIGH: the worker never reconnects** (`worker/src/spacetime/connection.ts` ~80, `.onDisconnect(() => undefined)`).
   - After a network blip the subscription cache is stale and nothing marks the source dead. `signalContext()` / `delivery()` keep returning old rows.
   - `commitNudge` then throws a plain `Error` with no `code:` prefix, so `classifyCommitError` (`adapters.ts` ~118) returns null. That is neither a recorded refusal nor a clear fault.
   - This is availability only, not privacy, because `commit_nudge` rechecks authoritatively.
   - Proposed fix: on disconnect, flip a `dead` flag so the read methods throw `unavailable`. Then `main.ts` either reconnects with backoff and resubscribes, or exits non-zero so the supervisor restarts it. Add an integration case: drop the connection mid-job, expect no commit and a clean retry or exit.

2. **MEDIUM: nickname exclusions fail open** (`src/features/voice/assessment.ts` ~25, `nameMatches`).
   - A match requires every written word to appear whole in the connection's name. So "not Alexander tonight" does **not** exclude a connection named "Alex", and "not Alex" does not exclude "Alexander".
   - CS added a fail-closed guard on its side: when the assessment has any name exclusion, **unnamed connections are left out**, and the owner sees a neutral line. CS also gives unnamed and duplicate connections distinct labels ("Connection 1", "Sam (2)").
   - The nickname case remains yours. Suggested options:
     - (a) when an excluded name matches nobody, return it as `unmatchedExclusions` so CS can ask the owner "Who did you mean?" (owner-only, neutral, counted against the 2-question cap)
     - (b) treat a prefix or diminutive match as ambiguous, so all candidates are left out
   - Tell CS which option you pick. CS will wire the question.

3. **The pause needs no worker change**, if #34 lands as written: paused pairs drop out of `worker_signal_context`, and `commit_nudge` rechecks. Please add your planned `worker/integration/` cases once #34 merges: pause before the job, pause during generation, and pause then resume (the old signal stays dead).

4. **Paid Stage C (nudge delivery) is still the big unverified piece.** The setup is ready on Rishi's machine:
   - local `dor-local`
   - worker identity `c200bdbc`, already allow-listed
   - three synthetic Clerk users, A/B paired and B opted in. Ids are in the CS handoff.

   To run it:
   - Needs `FACTORY_API_KEY`. The worker defaults to the SDK transport.
   - First run `node --env-file=.env.local --experimental-strip-types scripts/smoke-core3.ts`. It leaves A's signal **revoked**. Approve a fresh one, then start the worker.
   - **Revoke test signals before starting the worker, and never leave it running unattended.** Any standing approved signal triggers a paid Droid call.

---

## Nimisha (DS)

Hi Nimisha. There are no blockers for you. Here are some new cases worth labelling now, because CS behaviour changed and the audit found gaps the evals should pin down.

1. **New CS decision-loop behaviour to cover in the Core 1/2 fixtures:**
   - The assessment excludes someone and the owner has an **unnamed** connection: the unnamed connection is left out. Expected: `no_action` if nobody else remains, otherwise the remaining recipients are offered, and the owner sees a neutral note.
   - Two connections with the same display name: distinct labels ("Sam", "Sam (2)"). Expected: never auto-chosen.
   - A paused connection (D041, once merged): never offered. If it was the only candidate, expected `no_action`. Recipient-visible output must not change at all (noninterference).
2. **Nickname gap (assessment):** "not Alexander tonight" with a connection "Alex". Today this **fails open** (Alex stays eligible). Please add it as a labelled expected-`needs_clarification` or excluded case, so the gap is measured until Adam closes it. Add the reverse case too ("not Alex" vs "Alexander").
3. **Quiz "space":** the quiz no longer promises "suggests nothing". Choosing space only adds no support category to the preset drafts. A per-entry "space" answer still ends in `no_action`. If any fixture assumed the global promise, relabel it.
4. **Timing/indirect-disclosure labels:** the audit found that `my_nudges` exposes the commit and approval times to the recipient, and that receipts expose recipient state to the sender (Cyber fixing). When you define forbidden-disclosure labels, include "timing of the sender's approval" and "recipient opt-out/quiet state", so the noninterference check covers timing, not just content.
5. **Reason codes:** a wrong `payloadRevision` currently comes back as `no_consent`, not `stale_policy`. Hold any assertion on that code until Sumedh confirms.
