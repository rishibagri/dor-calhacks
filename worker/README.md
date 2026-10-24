# worker — `@kinetic/worker`

AI-owned Factory Droid worker. It receives content-free `CoordinationJob`s (C4) and approved signals, runs the bounded coordinator with a Droid-backed recipient agent, and returns sanitized outcomes. It never receives raw vault context.

Read root AGENTS.md, PRD.md, PROJECT_KNOWLEDGE.md, contracts/README.md and your role/handoff before implementation.

## Runtime requirements (tested)
- Node.js ≥ 20 (tested on v24.13.0, darwin arm64). Long-running process outside Vercel.
- `droid` CLI on `PATH` (tested 0.248.0; 0.249.0 is available). Override the path with `KINETIC_DROID_PATH`.
- Auth: `droid exec` works with the CLI login (tested). For deployment, set `FACTORY_API_KEY`. The `@factory/droid-sdk` TypeScript SDK (0.10.0) requires `FACTORY_API_KEY` and does not use the CLI login. It also only offers a deny-list for tools and pulls in vulnerable nested `zod@3` and `uuid@9`. We therefore call `droid exec` directly.
- Model `claude-haiku-5-5` by default (`KINETIC_DROID_MODEL` / `--model` to override), reasoning effort `low`, 8 s timeout per call (`KINETIC_DROID_TIMEOUT_MS`).

## Droid hardening (`DroidAckProposer`)
- `--only-tools TodoWrite`: the one allowlisted tool is a planning list with no file, shell, network or web access. Default read-only autonomy; never `--auto` or `--skip-permissions-unsafe`.
- `--disable-builtin-skills`; `--cwd` is one private `mkdtemp` directory per proposer, emptied before every call and removed by `close()`.
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

Each benchmark ran 3 × (partners, friends, family, and a two-option friends case), plus a revoked case with 0 Droid calls, using offline policy and preference stand-ins. Latency did not improve because about 3.5 s is Droid CLI startup; `droid daemon` is the next lever. Pass `onUsage` to `DroidAckProposer` to record numbers-only usage (credits, cache tokens, duration). The Factory auto router (`KINETIC_DROID_MODEL=auto`) is not used: routing can move the enums to non-Claude providers, which the processing notice would then need to list, and it makes latency and quality measurements unstable.

## Job transport
`createJobRequestHandler({ authToken, signals, coordinator, commit })` handles `POST /jobs`:
- Requires `Authorization: Bearer <KINETIC_WORKER_AUTH_TOKEN>` (≥ 32 chars, timing-safe compare).
- Accepts a strict `CoordinationJob` body (≤ 4 KiB). Returns `{ outcomes: CoordinationOutcome[] }` with `cache-control: no-store`.
- Errors use the API envelope `{error:{code,message,requestId}}` (401/404/409/413/422/503). Bodies are never logged or echoed.
- **Replay protection (`JobLedger`):**
  - Concurrent or retried requests with the same `jobId` share one coordination and one commit, and a completed job returns its recorded outcomes.
  - The same `jobId` with a different pair, request or signals returns 409.
  - A failed job is not recorded, so a retry runs fresh. It reuses the same `requestId`, so the nudge ID is identical.
  - Across worker restarts, `commit_nudge` must dedupe on `nudge.id`.

`runCoordinationJob(job, deps)` keeps only schema-valid envelopes from the job's pair whose IDs were requested, coordinates, then calls `commit.commit(result, job)`.

**CS must supply** (`worker/src/jobs.ts`, `src/agents` `CoordinatorDeps`):
- `ApprovedSignalSource.approvedSignals(pairId, signalIds)`: worker-identity SpacetimeDB read.
- `RecipientPreferencesPort.current(pairId, recipientId)`
- `CoordinationCommitPort.commit(result, job)`: a version-checked reducer that revalidates.
- `DeliveryStatePort.current(pairId, recipientId)` → `{ delivery: RecipientDelivery, lastNudgeAt }`, from the reducer that backs D017/D018.

**Live wiring:** `createLiveWorker({ authToken, policyState, signals, preferences, delivery, commit, rank?, droid? })` builds Cyber's real `DisclosurePolicy` over `policyState: PolicyStateReader`, the authoritative signal and pair/assignment/preset rows. There is no parameter for a policy object, so a fake cannot be wired in. It returns `{ handler, coordinator, close }`.
- Tested with a stubbed authoritative reader: approved work reaches Droid; revoked work and altered envelopes are denied with no Droid call.
- **Still missing:** a process entrypoint (`http.createServer(handler)`), which waits on CS's SpacetimeDB worker-identity adapters.

## Commands
```sh
npm run ai:check                                   # offline tests
node worker/scripts/live-droid.mjs --runs 4        # live Droid; policy and preferences are labeled offline stand-ins
```

## Verified (2026-10-24 UTC)
These runs used the contracts `FakeDisclosurePolicy` and fixture preferences, so this is live Droid execution, **not** an end-to-end live integration.

- ~02:52Z, 12 live runs (4 × partners/friends/family): 12/12 `nudge_proposed`, decided by the agent in round 1, with the expected template. Coordinate latency median 3,676 ms, p95 5,248 ms. Revoked-before-use: `policy_denied` with 0 Droid calls.
- ~03:10Z, after merging the D015 fixtures (friends is now support-only), 3 runs: 3/3 `nudge_proposed` by the agent with the expected templates. Partners took 5,786 ms and family 7,321 ms; friends took 15,013 ms because round 1 hit the 8 s timeout and round 2 answered. Revoked case passed again.
- Diagnosis, 4 direct calls with the friends input and a 30 s limit: every output was valid, but latency was 4.3, 12.4, 18.7 and 12.3 s. The variance is on the Factory/model side, not the prompt. **The 8 s per-call target is not reliably met right now.** The coordinator stays correct (round 2, then the deterministic fallback), but nudge latency can reach about 16 s before fallback.
