# worker — `@kinetic/worker`

AI-owned Factory Droid worker. It receives content-free `CoordinationJob`s (C4) and approved signals, runs the bounded coordinator with a Droid-backed recipient agent, and returns sanitized outcomes. It never receives raw vault context.

Read root AGENTS.md, PRD.md, PROJECT_KNOWLEDGE.md, contracts/README.md and your role/handoff before implementation.

## Runtime requirements (tested)
- Node.js ≥ 20 (tested on v24.13.0, darwin arm64). Long-running process outside Vercel.
- `droid` CLI on `PATH` (tested 0.248.0; 0.249.0 is available). Override the path with `KINETIC_DROID_PATH`.
- Auth: `droid exec` works with the CLI login (tested). For deployment, set `FACTORY_API_KEY`. The `@factory/droid-sdk` TypeScript SDK (0.10.0) requires `FACTORY_API_KEY` and does not use the CLI login. It also only offers a deny-list for tools and pulls in vulnerable nested `zod@3` and `uuid@9`. We therefore call `droid exec` directly.
- Model `claude-opus-5-5`, reasoning effort `low`, 8 s timeout per call (`KINETIC_DROID_TIMEOUT_MS`).

## Droid hardening (`DroidAckProposer`)
- `--only-tools TodoWrite`: the one allowlisted tool is a planning list with no file, shell, network or web access. Default read-only autonomy; never `--auto` or `--skip-permissions-unsafe`.
- `--disable-builtin-skills`; `--cwd` is a fresh empty temp directory, deleted after each call.
- The subprocess env is allowlisted (`PATH`, `HOME`, locale/proxy vars, `FACTORY_API_KEY`). Claude, Cartesia, Clerk and worker secrets are withheld.
- The prompt contains only approved enums and pre-filtered option enums: no signal, pair, user or consent IDs. stderr is discarded; stdout is capped at 64 KiB.
- **Known:** Factory persists a session transcript per call (locally under `~/.factory/sessions`, one directory per temp cwd, and per Factory's own retention). Audit of 15 live sessions: enum prompt only; zero IDs, keys or repo paths. A deployed worker needs session pruning or an ephemeral `HOME` (possible with `FACTORY_API_KEY` auth).

## Job transport
`createJobRequestHandler({ authToken, signals, coordinator, commit })` handles `POST /jobs`:
- Requires `Authorization: Bearer <KINETIC_WORKER_AUTH_TOKEN>` (≥ 32 chars, timing-safe compare).
- Accepts a strict `CoordinationJob` body (≤ 4 KiB). Returns `{ outcomes: CoordinationOutcome[] }` with `cache-control: no-store`.
- Errors use the API envelope `{error:{code,message,requestId}}` (401/404/413/422/503). Bodies are never logged or echoed.

`runCoordinationJob(job, deps)` keeps only schema-valid envelopes from the job's pair whose IDs were requested, coordinates, then calls `commit.commit(result, job)`.

**CS must supply** (`worker/src/jobs.ts`, `src/agents` `CoordinatorDeps`):
- `ApprovedSignalSource.approvedSignals(pairId, signalIds)`: worker-identity SpacetimeDB read.
- `RecipientPreferencesPort.current(pairId, recipientId)`
- `CoordinationCommitPort.commit(result, job)`: a version-checked reducer that revalidates.
- `lastNudgeAt(pairId, recipientId)`

**Cyber must supply** the real `DisclosurePolicyPort`. No process entrypoint exists yet: there are no production adapters to wire, and fakes must not be wired.

## Commands
```sh
npm run ai:check                                   # offline tests
node worker/scripts/live-droid.mjs --runs 4        # live Droid; policy and preferences are labeled offline stand-ins
```

## Verified (2026-10-24 UTC)
12 live runs (4 × partners/friends/family): 12/12 `nudge_proposed`, decided by the agent in round 1, with the expected template. Coordinate latency median 3,676 ms, p95 5,248 ms. Revoked-before-use: `policy_denied` with 0 Droid calls. These used the contracts `FakeDisclosurePolicy` and fixture preferences, so this is live Droid execution, **not** an end-to-end live integration.
