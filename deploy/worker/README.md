# Worker deployment (minimal)

One long-running Node process (`worker/dist/main.js`): one SpacetimeDB connection as the allow-listed worker
identity, event-driven sweeps, `POST /jobs`, `GET /healthz`. Not serverless. Nothing here is deployed yet.

## Files
- `Dockerfile`: two-stage image built from the repo root (`docker build -f deploy/worker/Dockerfile -t dor-worker .`). It contains only `contracts`, `@dor/agents`, `worker` and their production dependencies, and runs as the `node` user.
- `Dockerfile.dockerignore`: an allowlisted build context, so `.env*`, the app, docs and caches never enter the image.
- `compose.yaml`: restart policy, read-only root filesystem, `/tmp` tmpfs, no capabilities, port bound to loopback.
- `worker.env.example`: variable names only. Copy it to `worker.env`, which is git-ignored, and fill it in from the secret channel.

## Behavior
| Concern | How |
|---|---|
| Health | `GET /healthz` returns 200 `{"ok":true}` only while the database connection is up and 503 otherwise. The image `HEALTHCHECK` polls it every 30 s. |
| Restarts | The worker exits after `DOR_WORKER_MAX_OFFLINE_MS` (default 120 s) without a connection, or on a fatal error. `restart: unless-stopped`, or your platform's restart policy, brings it back. Plain Docker doesn't restart a container for being "unhealthy"; the self-exit covers that case. |
| Temporary files | `TMPDIR=/tmp` and `HOME=/tmp/home` on a tmpfs. Droid slot directories are emptied before each call and removed on shutdown. Factory session transcripts, which only exist when a model mode is enabled, also land on the tmpfs and are lost on restart. |
| No-model mode | `DOR_DROID_TRANSPORT=off` is the image default. Every model call fails immediately with `not_configured`, before any process or network work, so nudges use the fixed template and introductions run deterministically. The logs show `droid_transport: off` and `droid_call ... outcome: not_configured`. |
| Model mode | Opt in only after an owner cost decision: `DOR_DROID_TRANSPORT=sdk` + `FACTORY_API_KEY`. This mode is not exercised by this image's checks. |
| Logs | JSON lines with codes and counts only. No row contents, tokens or prompts. |

## Verified (local only, 2026-10-24)
No Docker was available, so the image itself was **not built**. Instead, the Dockerfile's build stage (`npm ci --ignore-scripts`, the three builds, `npm prune --omit=dev`) was replayed in a clean directory containing only the allowlisted context, and the resulting runtime layout was started against a disposable local SpacetimeDB with `DOR_DROID_TRANSPORT=off`:
- `/healthz` returned 200;
- a real core nudge was delivered with `decidedBy: fixed_template` and 0 provider calls;
- after the database was stopped, `/healthz` returned 503 and the worker retried;
- the only temporary file was an empty slot directory under `TMPDIR`.

**Before production:** run `docker build` once on a machine with Docker, and confirm that `HEALTHCHECK` turns healthy against a disposable database.

## Run against Maincloud (owner action)
1. Use the allow-listed worker identity's token from the owner's secret store; never a user token. `set_worker_identity` is already set on Maincloud.
2. `docker compose -f deploy/worker/compose.yaml up -d --build`, then `curl -s 127.0.0.1:8787/healthz`.
3. Expect `connected`, `droid_transport: off` and `listening` in `docker compose logs`.
