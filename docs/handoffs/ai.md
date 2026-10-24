# Planning reset notice — current main d7285eb

Read `docs/roles/ai.md` and README **R0–R6** for current assignments. The historical implementation handoff below is preserved; statements such as “not merged” describe its original commit. Current status is in PROJECT_KNOWLEDGE.md. This notice is not a consumer ACK or evidence of live verification. New scope: existing connections + opted-in nearby public profiles + local-event introductions. One-time approximate location; no inherited pair consent. Forwardable update: `docs/team-messages/ai.md`.

---

# AI handoff — R1–R3 implementation (2026-10-24 ~06:10Z)

**Branch:** `role/ai-voice` @ `ba354ef`+docs, based on main `4fe469a`. Pushed; not yet in a PR. **Status:** implemented and offline-verified only. No provider was called and no module is published. Budget used: B = 30 h from 05:45Z (deadline ≈ 11:45Z Oct 25).

## What exists now
| Piece | Files | Evidence kind |
|---|---|---|
| Worker DB adapters over `worker_signal_context`, `worker_delivery`, `commit_nudge`; prefs fail closed | `worker/src/spacetime/*` | Real module in-process (10 integration cases, 3 mutations caught) |
| Droid slot pool (`DroidRunner`), shared by ACK/intro/plan agents | `worker/src/droid-proposer.ts` | Unit (concurrency, queue overflow, shared budget) |
| `SignalWatcher` + process entrypoint (`/jobs`, `/healthz`) | `worker/src/{watcher,main}.ts` | Integration (restart → cooldown, 0 model calls); entrypoint not run (no bindings) |
| Voice/reflection feature component | `src/features/voice/*` | Unit (model rules) + production build + server render; no browser mic run |
| Introduction step (PROPOSED D033) | `contracts/src/introduction.ts`, `src/agents/src/introductions/*` | Contract + unit; no C8 state exists |
| Shared-plan step + lifecycle (PROPOSED D034) | `contracts/src/{plan,plan-lifecycle}.ts`, `src/agents/src/plans/*` | Contract + unit; no C7 catalogue/intent state exists |
| Full dry run, five journeys | `worker/integration/full-dry-run.test.ts`, `npm run ai:dryrun` | Real module + real AI code + LocalVault; synthetic accounts/providers/C8 state labeled per step |

Checks at `ba354ef`: `npm run check` 74/74, `npm run ai:check` agents 64 + worker 18 + integration 15, `npm run test:app` 108 + 1 known TODO, typecheck clean.

## Exact asks
- **CS:**
  1. Compose `<VoiceReflection vault={vault} onCandidate={(c, entryId) => …device-only preview…} />` from `@/features/voice` on the journal page. Its defaults call `/api/reflections` and `/api/voice/session`; pass `getVoiceSession={null}` for typed-only.
  2. Widen `ReflectionPort` to `PrivateReflection`, or let the component use its default client.
  3. After publishing, also generate bindings into `worker/src/module_bindings`.
  4. Run `set_worker_identity` for the worker token's identity.
  5. Pick the worker host: long-running Node with `droid`.
  6. Review D033/D034 shapes against your C7 catalogue and C8 publication records.
- **Sumedh:**
  1. A recipient support-preference consent view the worker can read (`RecipientSupportPreferences` shape). Until then live coordination returns `preferences_unavailable` by design.
  2. Review `classifyCommitError`: which reducer refusals are recorded and which are retried.
  3. Decide whether reducers adopt `@dor/contracts/plan-lifecycle` as the plan finalization guard.
  4. Decide whether the intro/plan fallback (`fixed_template`) is acceptable or must be off.
  5. Supply a `DiscoveryEligibilityPort` / `PlanCurrentStatePort` backing once C8 guards exist.
- **Nimisha:**
  1. Package `rankAckOptions` so the worker can import it (a workspace or contracts export); the worker passes `rank` through `createLiveWorker`.
  2. Produce `IntroductionShortlist` (≤ 3, rank order, overlap only) and rank `PlanRequest.events`.
  3. Compare `deterministicOnly: true` against model selection in your evaluation.

## Not done / next (R4–R5)
- Aggregate per-job deadline and reflection in-flight dedupe.
- Right-size `max_tokens` (still 16000).
- Live runs: Claude, Cartesia, Droid via `DOR_DRYRUN_LIVE_*`.
- Browser mic and TTS check.
- Worker entrypoint against a published module.

---

# Current coordination update — Adam (AI)

Read your updated detailed plan in docs/roles/ai.md and shared README.md phases. Task IDs are AI-P#; Cyber uses CYBER-P#. CS owns Apify ingestion; Nimisha matching; Adam bounded proposals; Sumedh disclosure/vault. Preserve existing work and review the main/role-branch status before selecting the first unmet phase. Forwardable message: docs/team-messages/ai.md. This notice does not ACK or complete any pending implementation/contract review.

---

# AI handoff
Status: AI-P1–P3 partially complete on `role/ai-voice` @ `a7316d5`, based on main @ `9096f81`; not yet in a PR. Here is what is done and what each piece has been verified against:
- **Implemented and unit-tested:** authenticated reflection and voice-session routes, browser voice helpers, and the worker wired to Cyber's real `DisclosurePolicy` with replay protection.
- **Measured live:** Droid credit optimization.
- **Not live:** Claude and Cartesia (no credentials), and full end-to-end coordination (no SpacetimeDB adapters yet).

## Evidence, kept separate by kind
| Kind | What ran | Result |
|---|---|---|
| Offline unit/contract | `npm run check`, `npm run ai:check`, `npm run check:all` from a clean `npm ci` | contracts 52/52; agents 45/45; worker 10/10; module 36/36; app 62/63 (1 `todo`, not AI); typecheck clean; `npm audit` 0 |
| Fixture-policy worker | `createLiveWorker` with a stubbed authoritative `PolicyStateReader` and fake Droid spawn | Approved work reaches Droid and is proposed; revoked work and altered envelopes return `policy_denied` with no Droid call |
| Isolated live Droid (fake policy and preferences) | `node worker/scripts/live-droid.mjs --runs 3 --model …` | Haiku: 12/12 agent-decided, 289 credits total (median 14/call), coordinate median 4.1 s, p95 6.1 s. Opus with reused dir: 12/12, 9,448 credits, 4.1 s / 5.6 s. M1 Opus with a new dir per call: ~9,900 credits/call cold. Revoked case: 0 Droid calls |
| App build/runtime | `npm run build:app`; `next start` + curl | Both routes compile as dynamic. Without Clerk: 503 `Authentication is not configured`, `no-store`; GET 405; request text absent from server logs |
| Missing credentials | `npm run live -w @dor/agents` | `SKIPPED_MISSING_CREDENTIAL` for `ANTHROPIC_API_KEY` and `CARTESIA_API_KEY` |
| Not yet run | Browser mic/AudioWorklet/Web Audio; signed-in route calls; real SpacetimeDB job → commit | No evidence yet |

## Latency limitation (unchanged, measured)
The 8 s per-call target is usually met but not guaranteed. Earlier direct Droid calls ranged from 4.3 to 18.7 s, and some runs needed round 2. About 3.5 s of every call is Droid CLI startup, whatever the model. When rounds fail, the coordinator stays correct through round 2 and then the deterministic fallback. Next lever: `droid daemon`.

## Integration needs (exact)
- **CS:**
  1. **ACK the route-file claim** for `src/app/api/reflections/route.ts` and `src/app/api/voice/session/route.ts`. They are thin, Clerk `auth()` → `handle*Request`; move or centralize the session helper as you prefer.
  2. Change `ReflectionPort.reflect` in `src/lib/backend/ports.ts` to return `PrivateReflection` (merged in contracts).
  3. Swap `placeholderReflection` for an adapter around `createReflectionClient()` from `@dor/agents/client`.
  4. Bind the journal UI to `VoiceDictation` (`onChange` snapshot; typed entry on any `error`) and `speak()`.
  5. Provide the worker adapters for `createLiveWorker`: `PolicyStateReader` (with Sumedh), `ApprovedSignalSource`, `RecipientPreferencesPort`, `DeliveryStatePort` and `CoordinationCommitPort`.
  6. Build a `commit_nudge` reducer restricted to the worker identity that calls `guardNudgeCommit` and dedupes on `nudge.id`.
  7. Choose a long-running Node host with the `droid` CLI.
- **Sumedh (Cyber):**
  1. Confirm the `PolicyStateReader` source: worker-identity view vs reducer read.
  2. Decide whether `RecipientSupportPreferences` needs its own consent guard or reuses the D017 opt-in.
  3. Review the route error and log boundary (codes only, no echo) and the browser token in the WebSocket query string (Cartesia's documented browser pattern; 60 s token).
  4. Verify Anthropic and Cartesia retention.
- **Nimisha (DS):** publish `rank(options, signal)` for `createLiveWorker({ rank })`; it may reorder or drop options, never add. Your `matchSignal` and my `eligibleOptions` should agree on `today ∩ this_week = today` and on availability-only giving no nudge. A shared fixture test would pin that.
- **Activity scope (AI-P6):** not started by design. It waits for CS's reviewed C7 `ActivityCatalogueItem`/`ActivityProposal` contract and Sumedh's activity consent categories. My side will be bounded proposals and counters chosen from catalogue IDs only. Scraped text is treated as data, gets no tools and no URL fetches, and both humans must accept the same proposal revision. There is no booking or messaging.

## Blockers
- `ANTHROPIC_API_KEY` and `CARTESIA_API_KEY` block live reflection, STT/TTS and the browser voice run. `FACTORY_API_KEY` is needed on a deployed worker.
- The real job → commit path waits on the CS/Cyber adapters above.

## History: M1 handoff (2026-10-24T03:09Z, superseded)

Read AGENTS.md, PRD.md, PROJECT_KNOWLEDGE.md, contracts/README.md, and docs/roles/ai.md. Work on the corresponding role branch. Do not use fake adapters in live mode.

### Update at each handoff
- UTC timestamp and branch/commit: 2026-10-24T03:09Z, `role/ai-voice`. `d940735` contract proposal (D021), `27cb467` adapters and worker, `d2045cd` merge of main @ `8e208df`; the docs commit sits on top.
- Completed work and interface IDs:
  - **Contracts (D021, proposed, additive):**
    - C1: `PrivateReflectionPort.reflect` → `PrivateReflection {schemaVersion, reflection ≤2000, candidate: SignalCandidate|null}`. `SignalCandidate` is enum-only `{supportMode?, availability?}`. `VoicePort` and `VoiceSession`.
    - C4: `RecipientSupportPreferences` (the recipient's own consent record), `CoordinationJob` (IDs only, ≤ 4 signals), `CoordinationOutcome` (sanitized codes, rounds 0–2, `decidedBy`). `CoordinationPort` results gain `outcomes`.
    - Schemas, fixtures and contract tests were updated together; no existing shape changed.
  - **`@dor/agents` (`src/agents/`):** `ClaudeReflectionAdapter`, `CartesiaVoiceAdapter`, `BoundedCoordinator` (+ `eligibleOptions`, `intersectWindow`, `TEMPLATE_BY_MODE`), `ProviderError`/`httpStatusFor`, `PROVIDER_PROCESSING`. Synthetic doubles are only under `@dor/agents/testing`. Fixtures: `fixtures/{reflection,voice,coordination}.synthetic.json`. Details are in src/agents/README.md.
  - **`@dor/worker` (`worker/`):** `DroidAckProposer` runs `droid exec` with `--only-tools TodoWrite`, read-only autonomy, an empty temp cwd and an allowlisted env. Also `runCoordinationJob` and `createJobRequestHandler` (bearer-auth `POST /jobs`). Details are in worker/README.md.
- Verification (actual results):
  - Offline: `npm run check` 26/26 (includes CS's flow tests); `npm run ai:check` agents 34/34, worker 6/6; `npm run check:all` exit 0 (module 16/16, root typecheck covers `src/agents`, test:app 4/4); `npm audit` 0. Mutation check: disabling the post-generation revocation recheck fails `revoked-during-generation`.
  - **Live Factory Droid** (droid 0.248.0, CLI login, model `claude-opus-5-5`, node v24.13.0, darwin arm64):
    - 12/12 runs decided by the agent with the expected template; median 3,676 ms, p95 5,248 ms.
    - After the D015 merge: 3/3 pass, but friends took 15,013 ms because round 1 timed out.
    - Direct calls varied from 4.3 to 18.7 s.
    - Revoked-before-use made 0 Droid calls.
    - Policy and preferences were the offline `FakeDisclosurePolicy` and fixtures, so this is **not** end-to-end.
  - **Factory session audit:** 15 persisted transcripts contain only the enum prompt; 0 pair, signal or consent IDs, keys or repo paths.
  - **Live Claude and Cartesia:** `npm run live -w @dor/agents` reports `SKIPPED_MISSING_CREDENTIAL` for both.

### Tested runtime requirements
| Component | Requirement | Tested |
|---|---|---|
| Node | ≥ 20, ESM | v24.13.0 |
| Claude | `@anthropic-ai/sdk@1.3.0`, `ANTHROPIC_API_KEY`, Node runtime route (not edge) | Offline only |
| Cartesia | `@cartesia/cartesia-js@4.2.0` (`Cartesia-Version: 2026-08-14`), `CARTESIA_API_KEY` server-side only | Offline only |
| Factory | `droid` CLI on PATH (0.248.0; 0.249.0 available), CLI login or `FACTORY_API_KEY`, long-running host outside Vercel | Live |
| Not used | `@factory/droid-sdk@0.10.0`: needs `FACTORY_API_KEY`, offers only a tool deny-list, nested vulnerable `zod@3`/`uuid@9` | Probed, rejected |

### Consumer and exact next action
- **CS:**
  1. Review D021 (contracts + `contracts/README.md`).
  2. Widen `ReflectionPort.reflect` in `src/lib/backend/ports.ts` to return `PrivateReflection` from `@dor/contracts` (a superset of `{reflection}`), so the UI receives `candidate`.
  3. Supply the worker ports `ApprovedSignalSource`, `RecipientPreferencesPort`, `CoordinationCommitPort` (version-checked `commit_nudge` reducer) and `DeliveryStatePort` (D017 opt-in, D018 quiet hours and last nudge).
  4. Decide the worker host: a long-running Node host with the `droid` CLI.
  5. Optionally add `npm run ai:check` to `.github/workflows/contracts.yml`.
  - AI will write the adapter and the `POST /api/reflections` and `POST /api/voice/session` routes next. I'll claim those files first; tell me if you prefer to own the route shells.
- **Cyber:**
  1. Review the D021 privacy boundary: the candidate stays local, `RecipientSupportPreferences` is a consent record, and outcome codes are sanitized.
  2. Review the Droid hardening (worker/README.md) and the Factory session-persistence note.
  3. Supply a real `DisclosurePolicyPort`, and say whether recipient-preferences consent needs its own reducer guard.
  4. Verify Anthropic and Cartesia retention. Both are marked `unverified` in `PROVIDER_PROCESSING`; Cartesia zero retention is enterprise-only.
- **DS:**
  1. Confirm the intersection semantics in src/agents/README.md: `today` ∩ `this_week` = `today`; availability is matched only when the recipient consented to share it.
  2. Extend `src/agents/fixtures/coordination.synthetic.json`.
  3. Supply `rank(options, signal)`; it may reorder or drop options, never add them.
  4. Reflection fixtures can seed the 30-case evaluation.
- **Team decision:** self-harm language makes the reflection point to emergency or crisis support (988 in the US) and forces `candidate: null`. Confirm the behavior and the copy.

### Blockers / unresolved contract decisions
- Missing credentials: `ANTHROPIC_API_KEY` and `CARTESIA_API_KEY` block live Claude and Cartesia verification. `FACTORY_API_KEY` is needed on a deployed worker.
  - To run: put the keys in the repo-root `.env.local`, then `npm run ai:build && npm run live -w @dor/agents`.
- D021 is merged via PR #4; CS, Cyber and DS consumer review remains pending.
- Droid latency is above the 8 s per-call target at times. Options: raise the Droid timeout (nudges are asynchronous), use a lower-effort or smaller model on Factory (team call), or accept the deterministic fallback.
- Factory keeps a session directory per call under `~/.factory/sessions`. A deployed worker needs pruning or an ephemeral `HOME`.

### Planned work
Hour 7 milestone: app reflection and voice routes, then browser mic capture plus a streaming `ink-2` STT client with turn detection and stop/interrupt, plus TTS playback. After that: typed fallback paths, latency measurements over ≥ 10 seeded runs per provider once keys exist, and a worker process entrypoint once CS and Cyber adapters exist.
