# worker — `@dor/worker`

AI-owned Factory Droid worker. It receives content-free `CoordinationJob`s (C4) and approved signals, runs the bounded coordinator with a Droid-backed recipient agent, and returns sanitized outcomes. It never receives raw vault context.

Read root AGENTS.md, PRD.md, PROJECT_KNOWLEDGE.md, contracts/README.md and your role/handoff before implementation.

## Runtime requirements (tested)
- Node.js ≥ 20 (tested on v24.13.0, darwin arm64). Long-running process outside Vercel.
- `droid` CLI on `PATH` (tested 0.248.0; 0.249.0 is available). Override the path with `DOR_DROID_PATH`.
- Auth: `droid exec` works with the CLI login (tested). For deployment, set `FACTORY_API_KEY`. The `@factory/droid-sdk` TypeScript SDK (0.10.0) requires `FACTORY_API_KEY` and does not use the CLI login. It also only offers a deny-list for tools and pulls in vulnerable nested `zod@3` and `uuid@9`. We therefore call `droid exec` directly.
- Model `claude-haiku-5-5` by default (`DOR_DROID_MODEL` / `--model` to override), reasoning effort `low`, 8 s timeout per call (`DOR_DROID_TIMEOUT_MS`).

## Droid hardening (`DroidAckProposer`)
- `--only-tools TodoWrite`: the one allowlisted tool is a planning list with no file, shell, network or web access. Default read-only autonomy; never `--auto` or `--skip-permissions-unsafe`.
- `--disable-builtin-skills`; `--cwd` is one private `mkdtemp` directory per runner slot, emptied before every call and removed by `close()`.
- The subprocess env is allowlisted (`PATH`, `HOME`, locale/proxy vars, `FACTORY_API_KEY`). Claude, Cartesia, Clerk and worker secrets are withheld.
- The prompt contains only approved enums and pre-filtered option enums: no signal, pair, user or consent IDs. stderr is discarded; stdout is capped at 64 KiB.
- **Known:** Factory persists a session transcript per call (locally under `~/.factory/sessions`, one directory per temp cwd, and per Factory's own retention). Audit of 15 live sessions: enum prompt only; zero IDs, keys or repo paths. A deployed worker needs session pruning or an ephemeral `HOME` (possible with `FACTORY_API_KEY` auth).

## Credit usage (measured 2026-10-24)
Droid's system prompt includes the working directory, so a new directory per call defeats Factory's prompt cache. The task is choosing among pre-approved enum options, which needs no frontier model.

| Configuration | Credits per call | 12-call total | Agent-decided | Coordinate median / p95 |
|---|---|---|---|---|
| Opus 5.5, new directory per call (M1) | ~9,900 cold (1 measured call) | ~118,000 (est.) | 12/12 | 3.7 s / 5.2 s |
| Opus 5.5, reused directory | median 570, max 1,964 | 9,448 | 12/12 | 4.1 s / 5.6 s |
| **Haiku 5.5, reused directory (default)** | **median 14, max 45** | **289** | **12/12** | 4.1 s / 6.1 s |

Each benchmark ran 3 × (partners, friends, family, and a two-option friends case), plus a revoked case with 0 Droid calls, using offline policy and preference stand-ins. Latency did not improve because about 3.5 s is Droid CLI startup; `droid daemon` is the next lever. Pass `onUsage` to `DroidAckProposer` to record numbers-only usage (credits, cache tokens, duration). The Factory auto router (`DOR_DROID_MODEL=auto`) is not used: routing can move the enums to non-Claude providers, which the processing notice would then need to list, and it makes latency and quality measurements unstable.

## Job transport
`createJobRequestHandler({ authToken, signals, coordinator, commit })` handles `POST /jobs`:
- Requires `Authorization: Bearer <DOR_WORKER_AUTH_TOKEN>` (≥ 32 chars, timing-safe compare).
- Accepts a strict `CoordinationJob` body (≤ 4 KiB). Returns `{ outcomes: CoordinationOutcome[] }` with `cache-control: no-store`.
- Errors use the API envelope `{error:{code,message,requestId}}` (401/404/409/413/422/503). Bodies are never logged or echoed.
- **Replay protection (`JobLedger`):**
  - Concurrent or retried requests with the same `jobId` share one coordination and one commit, and a completed job returns its recorded outcomes.
  - The same `jobId` with a different pair, request or signals returns 409.
  - A failed job is not recorded, so a retry runs fresh. It reuses the same `requestId`, so the nudge ID is identical.
  - Across worker restarts, `commit_nudge` must dedupe on `nudge.id`.

`runCoordinationJob(job, deps)` keeps only schema-valid envelopes from the job's pair whose IDs were requested, coordinates, then calls `commit.commit(result, job)`.

## Database-backed adapters (AI-R1)
`spacetimeWorkerPorts(source, preferences?)` (`src/spacetime/adapters.ts`) builds every port `createLiveWorker` needs from one `WorkerStateSource`. That source is three reads plus one call, made as the allow-listed worker identity:

| Port | Backed by | Behavior |
|---|---|---|
| `policyState` (`PolicyStateReader`) | `worker_signal_context` view | Mirrors `policy_state.ts`; Cyber's real `DisclosurePolicy` runs over it |
| `signals` (`ApprovedSignalSource`) | `worker_signal_context` view | Envelopes come from the view, never from the job request |
| `delivery` (`DeliveryStatePort`) | `worker_delivery` view | No row means not opted in (D017) |
| `commit` (`CoordinationCommitPort`) | `commit_nudge` reducer | Binds `recipient_consent_id/version` from the compatible `AgentAck` (D035); a nudge without one is refused locally. Guard refusals (`stale`, `quiet_hours`, `cooldown`, …) become recorded outcomes; transport faults and `worker only` throw so the job retries |
| `preferences` (`RecipientPreferencesPort`) | `worker_support_preferences` view (D035) | `SpacetimeRecipientPreferences`: the recipient's own consent recorded via `set_support_preferences`. No row, or a source without `supportPreferences()`, means no consent: no nudge, 0 model calls |

Rows are mapped by `src/spacetime/rows.ts`, which accepts snake_case harness rows and camelCase generated rows, as well as tagged options. A row that does not map is dropped, so drift fails closed. `SpacetimeWorkerConnection` (`src/spacetime/connection.ts`) is the live source over generated client bindings.

**Live wiring:** `createLiveWorker({ authToken, policyState, signals, preferences, delivery, commit, rank?, droid? })` builds Cyber's real `DisclosurePolicy` over `policyState`. It has no parameter for a policy object, so a fake cannot be wired in. It returns `{ handler, runJob, coordinator, runner, close }`; `runJob` shares the handler's `JobLedger`, and `runner` is the shared Droid slot pool for the plan and introduction paths.

## Shared plans (AI-R3, D034/D039) — `src/plans.ts`
`PlanWatcher` reads `worker_plan_candidates`, groups rows by basis (accepted introduction or pair with C7 approvals), and runs one `runPlanJob` per basis whose fingerprint (events, exact intent ids/versions, approvals) changed. `PlanCoordinator` makes 0 model calls for one usable event and at most 1 call + 1 repair for 2–3. It rechecks the same `(basis, event)` row with identical intents after generation, then commits through `commit_plan_proposal` with exactly those ids and versions. Plan IDs are stable per basis and event, so a restart re-commits as a no-op. `stale`/`not_found` refusals become `not_current`/`source_stale`; `invalid`, `worker only` and transport faults throw and are retried (≤ 3 attempts per fingerprint).

D034's `PlanParticipant.intentVersion` is per person, while the module versions intents per event. Participants are therefore positional (`participant_a`/`participant_b`, as the view orders intents) with a constant version, and the exact per-event binding is done by the adapter recheck plus the reducer. The plan path is enabled only when the bindings carry both `worker_plan_candidates` and `commit_plan_proposal`; the current generated bindings predate D039, so CS must regenerate them.

## Introductions (AI-R2, D033/D038) — `src/introductions.ts`
`runIntroductionJob(shortlist, { source, runner, eligibility, clock })` runs `IntroductionCoordinator` and commits through `commit_introduction_proposal` into the viewer's private suggestions. A refusal is recorded as `stale`; `worker only` throws. While the D038 commit accepts `shared_interest` only, event overlap is stripped before any model call (`sameEventSupported: false`). **Not wired into `main.ts`:** the module has no worker-readable source of discovery shortlists and current eligibility yet (open ask to Cyber/CS).

## SDK transport (default) — `src/droid-sdk.ts`
The worker uses `@factory/droid-sdk` sessions by default; `DOR_DROID_TRANSPORT=cli` restores the per-call `droid exec` spawn. Without `FACTORY_API_KEY` the worker refuses to start rather than silently switching transport. `DroidRunner` keeps the slots, queue, job deadline and usage reporting. Only the call itself moves to `DroidSdkTransport`.
- **Warm pool, no shared context:** each slot keeps one started, tool-verified spare session. A session answers exactly one prompt and is then closed; the next spare warms in the background. The working directory is the slot's private directory, as with the CLI.
- **Tool allowlist:** a new SDK session enables 16 tools by default, including `Execute`, `FetchUrl`, `WebSearch` and `Read` (measured). The SDK only has `disabledToolIds`, so every session's `listTools()` is checked against `SDK_ALLOWED_TOOLS` = `TodoWrite` + `ToolSearch`. `ToolSearch` cannot be disabled (measured); it only returns tool definitions. Extra tools are added to a learned deny-list and the session is recreated; if that fails, the session is refused (`not_configured`) and no prompt is sent.
- **Locked down:** autonomy is `off`, `autoRejectPermissionRequests`, and builtin skills are disabled. Any `tool_call` in a turn is `invalid_output`. The deadline aborts the stream and that session is discarded. The reply is parsed from text, as on the CLI path.
- **Usage:** per call, `factoryCredits` and cache tokens from `tokenUsage`, plus `outcome` (`ok` or the failure code). The worker logs it in `droid_call`.
- **Dependency:** `@factory/droid-sdk@0.10.0` (exact). It nests `zod@3` (GHSA-mrhx-c7xc-m3w5, high) and `uuid@9` (GHSA-w5hq-g745-h8pq, moderate), with no non-breaking fix; Cyber review pending. Its deps only declare `prepare` hooks, which don't run on registry installs.
- **Measured 2026-10-24, synthetic stand-ins (FakeDisclosurePolicy, fixture preferences), Haiku, droid 0.248.0:**
  - SDK, 1 run × 4 cases: 4/4 agent-decided in round 1 with the expected template; revoked 0 calls. Call median 1.8 s (CLI record 4.1 s). **Credits: median 256 per call, 1,081 total**, against about 14 per call on the CLI record. This is unresolved: it is either a different credit unit in the SDK's `tokenUsage.factoryCredits` or a larger session prompt (about 3.8k cache-read tokens per call). Team decision (Adam, 2026-10-24): the SDK is the default. Cost only needs to stay within the credit budget, so watch the `credits` field in `droid_call` logs rather than optimizing further.

## Job deadline
Every job gets one aggregate model budget (`jobDeadlineMs`/`deadlineMs`, default 25 s) covering slot wait and all rounds. Past it, `DroidRunner` fails the call with `timeout` without spawning, so the coordinator moves straight to its labeled fallback or no suggestion. A queued call leaves the queue at its deadline, so a released slot never goes to a job that has given up.

## Process (`src/main.ts`, `npm start -w @dor/worker`)
- **Event-driven (`src/loop.ts`, `WorkerLoop`):** a new row in `worker_signal_context` or `worker_plan_candidates` triggers a debounced sweep (200 ms) right away. A fallback sweep runs every `DOR_WORKER_SWEEP_MS` (default 15 s) in case an event is missed.
- **Connection failures (Core 3 audit HIGH, fixed):**
  - The connection uses the SDK's automatic reconnect (`withAutomaticReconnect`).
  - From a drop until the replayed subscription applies again, every read and commit throws `unavailable: disconnected`, so the stale cache is never used, and no sweep runs.
  - A disconnect never uses up a job's attempts. The retry after reconnecting is safe because nudge and plan IDs are stable and the reducers are idempotent; if the first commit had landed, the cooldown gate stops the retry before any model call.
  - If the SDK will not retry, or the outage exceeds `DOR_WORKER_MAX_OFFLINE_MS` (default 2 min), the process exits with code 1 so its supervisor restarts it.
  - `GET /healthz` returns 503 `{"ok":false}` while disconnected.
- One SpacetimeDB connection as the worker identity, plus `SignalWatcher`: each sweep starts one job per newly visible approved signal, with `requestId = signalId`. Nudge IDs are therefore stable across restarts, `commit_nudge` dedupes them, and the cooldown pre-check skips Droid for a pair it already nudged.
- `PlanWatcher` in the same loop when the bindings include the plan view and reducer (`plans` log line says whether it is enabled).
- `POST /jobs` (above) and `GET /healthz`. Logs are JSON codes and counts only: `connected`, `droid_transport`, `disconnected`, `reconnected`, `fatal_connection`, `droid_call`, `outcome`, `job_error`.
- Env: `DOR_WORKER_AUTH_TOKEN`, `DOR_SPACETIME_URI`, `DOR_SPACETIME_MODULE`, `DOR_SPACETIME_WORKER_TOKEN`, `PORT`, `DOR_WORKER_SWEEP_MS`, `DOR_WORKER_MAX_OFFLINE_MS`, `DOR_DROID_{MODEL,PATH,TIMEOUT_MS,CONCURRENCY,TRANSPORT}`, `FACTORY_API_KEY`.
- **D041 pause:** the worker needs no change. Paused pairs leave `worker_signal_context`, the coordinator rechecks policy after generation (before any fallback commit), and `commit_nudge` refuses a late pause. Five integration cases in `integration/dry-run.test.ts` cover this.
- **Refuses to start** until the module is published and bindings are generated into `src/module_bindings` (`spacetime generate --lang typescript --out-dir worker/src/module_bindings --module-path spacetimedb`). The admin then runs `set_worker_identity` for the worker token's identity.

## Droid concurrency
`DroidRunner` owns a fixed pool of private slot directories (`concurrency`, default 2). Each slot holds its directory for the whole run, so concurrent jobs never empty each other's directory, and reused slots keep Factory's prompt cache warm. Waiting calls queue up to `maxQueue` (default 16) and fail fast with `rate_limited` beyond that. `DroidAckProposer`, `DroidIntroProposer` and `DroidPlanProposer` share one runner, giving the worker a single concurrency budget.

## Commands
```sh
npm run ai:check                                   # offline tests + dry run over the in-process module
npm run ai:dryrun                                  # full five-journey trace (DOR_DRYRUN_REPORT=out.md to save)
DOR_DRYRUN_LIVE_DROID=1 npm run ai:dryrun      # same, with real droid (spends Factory credits)
# The dry run reads .env.local only after that shell opt-in; offline runs never load provider keys.
node worker/scripts/live-droid.mjs --runs 4        # live Droid; policy and preferences are labeled offline stand-ins
```

## Verified (2026-10-24 UTC)
These runs used the contracts `FakeDisclosurePolicy` and fixture preferences, so this is live Droid execution, **not** an end-to-end live integration.

- ~02:52Z, 12 live runs (4 × partners/friends/family): 12/12 `nudge_proposed`, decided by the agent in round 1, with the expected template. Coordinate latency median 3,676 ms, p95 5,248 ms. Revoked-before-use: `policy_denied` with 0 Droid calls.
- ~03:10Z, after merging the D015 fixtures (friends is now support-only), 3 runs: 3/3 `nudge_proposed` by the agent with the expected templates. Partners took 5,786 ms and family 7,321 ms; friends took 15,013 ms because round 1 hit the 8 s timeout and round 2 answered. Revoked case passed again.
- Diagnosis, 4 direct calls with the friends input and a 30 s limit: every output was valid, but latency was 4.3, 12.4, 18.7 and 12.3 s. The variance is on the Factory/model side, not the prompt. **The 8 s per-call target is not reliably met right now.** The coordinator stays correct (round 2, then the deterministic fallback), but nudge latency can reach about 16 s before fallback.
