# AI handoff
Status: Milestone 1 on `role/ai-voice`, not yet merged to main. Adapters and the bounded coordinator are implemented and offline-verified. **Factory Droid execution is live-verified**, using offline policy and preference stand-ins. **Claude and Cartesia are not live-verified**: there are no credentials. No app route uses these adapters yet.

Read AGENTS.md, PRD.md, PROJECT_KNOWLEDGE.md, contracts/README.md, and docs/roles/ai.md. Work on the corresponding role branch. Do not use fake adapters in live mode.

## Update at each handoff
- UTC timestamp and branch/commit: 2026-10-24T03:09Z, `role/ai-voice`. `d940735` contract proposal (D021), `27cb467` adapters and worker, `d2045cd` merge of main @ `8e208df`; the docs commit sits on top.
- Completed work and interface IDs:
  - **Contracts (D021, proposed, additive):**
    - C1: `PrivateReflectionPort.reflect` → `PrivateReflection {schemaVersion, reflection ≤2000, candidate: SignalCandidate|null}`. `SignalCandidate` is enum-only `{supportMode?, availability?}`. `VoicePort` and `VoiceSession`.
    - C4: `RecipientSupportPreferences` (the recipient's own consent record), `CoordinationJob` (IDs only, ≤ 4 signals), `CoordinationOutcome` (sanitized codes, rounds 0–2, `decidedBy`). `CoordinationPort` results gain `outcomes`.
    - Schemas, fixtures and contract tests were updated together; no existing shape changed.
  - **`@kinetic/agents` (`src/agents/`):** `ClaudeReflectionAdapter`, `CartesiaVoiceAdapter`, `BoundedCoordinator` (+ `eligibleOptions`, `intersectWindow`, `TEMPLATE_BY_MODE`), `ProviderError`/`httpStatusFor`, `PROVIDER_PROCESSING`. Synthetic doubles are only under `@kinetic/agents/testing`. Fixtures: `fixtures/{reflection,voice,coordination}.synthetic.json`. Details are in src/agents/README.md.
  - **`@kinetic/worker` (`worker/`):** `DroidAckProposer` runs `droid exec` with `--only-tools TodoWrite`, read-only autonomy, an empty temp cwd and an allowlisted env. Also `runCoordinationJob` and `createJobRequestHandler` (bearer-auth `POST /jobs`). Details are in worker/README.md.
- Verification (actual results):
  - Offline: `npm run check` 26/26 (includes CS's flow tests); `npm run ai:check` agents 34/34, worker 6/6; `npm run check:all` exit 0 (module 16/16, root typecheck covers `src/agents`, test:app 4/4); `npm audit` 0. Mutation check: disabling the post-generation revocation recheck fails `revoked-during-generation`.
  - **Live Factory Droid** (droid 0.248.0, CLI login, model `claude-opus-5-5`, node v24.13.0, darwin arm64):
    - 12/12 runs decided by the agent with the expected template; median 3,676 ms, p95 5,248 ms.
    - After the D015 merge: 3/3 pass, but friends took 15,013 ms because round 1 timed out.
    - Direct calls varied from 4.3 to 18.7 s.
    - Revoked-before-use made 0 Droid calls.
    - Policy and preferences were the offline `FakeDisclosurePolicy` and fixtures, so this is **not** end-to-end.
  - **Factory session audit:** 15 persisted transcripts contain only the enum prompt; 0 pair, signal or consent IDs, keys or repo paths.
  - **Live Claude and Cartesia:** `npm run live -w @kinetic/agents` reports `SKIPPED_MISSING_CREDENTIAL` for both.

## Tested runtime requirements
| Component | Requirement | Tested |
|---|---|---|
| Node | ≥ 20, ESM | v24.13.0 |
| Claude | `@anthropic-ai/sdk@1.3.0`, `ANTHROPIC_API_KEY`, Node runtime route (not edge) | Offline only |
| Cartesia | `@cartesia/cartesia-js@4.2.0` (`Cartesia-Version: 2026-08-14`), `CARTESIA_API_KEY` server-side only | Offline only |
| Factory | `droid` CLI on PATH (0.248.0; 0.249.0 available), CLI login or `FACTORY_API_KEY`, long-running host outside Vercel | Live |
| Not used | `@factory/droid-sdk@0.10.0`: needs `FACTORY_API_KEY`, offers only a tool deny-list, nested vulnerable `zod@3`/`uuid@9` | Probed, rejected |

## Consumer and exact next action
- **CS:**
  1. Review D021 (contracts + `contracts/README.md`).
  2. Widen `ReflectionPort.reflect` in `src/lib/backend/ports.ts` to return `PrivateReflection` from `@kinetic/contracts` (a superset of `{reflection}`), so the UI receives `candidate`.
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

## Blockers / unresolved contract decisions
- Missing credentials: `ANTHROPIC_API_KEY` and `CARTESIA_API_KEY` block live Claude and Cartesia verification. `FACTORY_API_KEY` is needed on a deployed worker.
  - To run: put the keys in the repo-root `.env.local`, then `npm run ai:build && npm run live -w @kinetic/agents`.
- D021 needs CS, Cyber and DS review before merging to main.
- Droid latency is above the 8 s per-call target at times. Options: raise the Droid timeout (nudges are asynchronous), use a lower-effort or smaller model on Factory (team call), or accept the deterministic fallback.
- Factory keeps a session directory per call under `~/.factory/sessions`. A deployed worker needs pruning or an ephemeral `HOME`.

## Planned work
Hour 7 milestone: app reflection and voice routes, then browser mic capture plus a streaming `ink-2` STT client with turn detection and stop/interrupt, plus TTS playback. After that: typed fallback paths, latency measurements over ≥ 10 seeded runs per provider once keys exist, and a worker process entrypoint once CS and Cyber adapters exist.
