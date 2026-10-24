# AI reply to the Core 3 audit (Adam, 2026-10-24)

Replies to the AI items in [core3-audit.md](core3-audit.md). Branch `role/ai-voice`; PR to follow. Offline-verified unless stated otherwise.

**1. HIGH, the worker never reconnects: fixed.**
- The worker turns on the SDK's automatic reconnect.
- From a drop until the replayed subscription applies again, every read and commit throws `unavailable: disconnected`. The stale cache is never used, and no sweep runs.
- Disconnects don't use up a job's retries. The retry is safe: if the first commit had landed, the cooldown gate stops it before any model call, and reducers are idempotent on the stable IDs.
- Sweeps are now **event-driven**: a new row in a worker view triggers one at once, with a 15 s fallback interval.
- If the SDK won't retry, or the database is unreachable for 2 minutes, the worker exits with code 1 for a supervisor restart. `/healthz` returns 503 while disconnected.
- Tests: 7 unit, 2 integration (drop before commit; drop after commit but before ack: still exactly one nudge), 4/4 mutations caught.
- **Rishi:** RUNBOOK §3 now says to run the worker under a supervisor.

**2. MEDIUM, nickname exclusions: fixed, with an option for CS.**
- Exclusions now match a whole word or a 3+ letter prefix either way: "not Alexander" leaves out "Alex", and the reverse. "Al" still matches nothing. Preferences stay strict, because they only reorder.
- **Rishi:** if you want option (a), `unmatchedExclusions(connections, assessment)` returns excluded names that matched nobody (e.g. "Bob" ↔ "Robert"), so you can show an owner-only note or ask "Who did you mean?".
- **Nimisha:** your nickname cases should pass as excluded now.

**3. Pause: confirmed no worker change.** Five integration cases through the real module and worker pass:
- pause before the job (0 Droid calls)
- pause during generation, including the fallback path
- pause just before commit (refused)
- pause then resume (the old signal stays dead; a fresh approval works)
- a committed nudge disappears once paused

**4. Paid Stage C:** still the main unverified piece. The Droid calls need `FACTORY_API_KEY` on the machine with the published DB. Rishi and I need to pick whose machine to use; I'll follow the revoke-before-start safety rule.

**r4m → D042 (done):**
- Rishi, thanks for the app guard in #37. Per your follow-up, the contract now **requires an assessment whenever there is a candidate** (`PrivateReflectionSchema` refine), and the comment no longer says "ask normally". `contracts/fixtures/interfaces.json` gained the missing assessment, and D042 is recorded in DECISIONS.
- **Nimisha:** as CS's follow-up says, wrap `replay()` with `failClosedWithoutAssessment` and give the candidate-carrying cases an explicit assessment. Your fixtures, your labels.

**Live so far (isolated, synthetic, approved):**
- **Claude** reflection + assessment on 10 cases (Opus 5.5): every hard safety check held, at about $0.01 per call.
- **Cartesia** token, TTS and STT round trip pass.
