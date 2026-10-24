# dor runbook — setup, start and reset (Core 3/4 prep)

Status: **tooling only.** These steps configure real services; nothing here has been run end to end yet. Live verification (two signed-in accounts plus a denied third account, revoke/reconnect, provider failure paths) is a separate, later testing phase and is not claimed by this document.

All scripts print by default and act only with `--run`. None of them print secret values.

## 0. Check configuration (offline)
```sh
cp .env.example .env.local          # first time only; fill values locally, never commit
npm ci
npm run setup:doctor                 # core: app + module + auth
npm run setup:doctor -- --worker     # also the worker
```
Fix every `ERROR`. `warn` lines name optional features (for example, voice without `CARTESIA_API_KEY` falls back to typed journaling).

Clerk prerequisites (dashboard, done once):
- JWT template named as `NEXT_PUBLIC_CLERK_SPACETIME_JWT_TEMPLATE` (default `spacetimedb`) with a fixed `aud` claim. Put the same string in `DOR_AUTH_AUDIENCE`. The existing dev template uses the pre-rename audience; renaming both to `dor-spacetimedb` is recommended.
- `DOR_CLERK_ISSUER` = the Frontend API origin, for example `https://<instance>.clerk.accounts.dev`.

## 1. Database
Local: `spacetime start --listen-addr 127.0.0.1:3100`. The default port 3000 collides with `next dev`. Then set `NEXT_PUBLIC_SPACETIMEDB_URI=ws://localhost:3100` and `spacetime server add --url http://127.0.0.1:3100 dor-local` once.
Hosted: `spacetime login` and use `--server maincloud` with `wss://maincloud.spacetimedb.com`.

```sh
npm run setup:module -- --server dor-local          # print the plan
npm run setup:module -- --server dor-local --run    # publish, auth issuer/audience, allowlists, bindings
```
The `spacetime login` that publishes becomes the module owner. Run every later admin call under the same login. Core setup keeps the discovery/event flag **off**; add `--extensions` only when deliberately enabling them.
After any module change, run `npm run bindings:check` (regenerates into a temp dir and diffs both committed binding copies).

## 2. Worker identity
```sh
npm run setup:worker -- --server dor-local          # print the plan
npm run setup:worker -- --server dor-local --run    # mint identity, save token to .cache/worker-token, allow-list
```
Copy `.cache/worker-token` into `DOR_SPACETIME_WORKER_TOKEN` on the worker host. Set `DOR_WORKER_AUTH_TOKEN` (≥ 32 random chars) identically for the app routes and the worker. The worker identity must never be registered as a user account.

## 3. Start
```sh
npm run dev                          # app on :3000 (core mode: Discover/Events hidden)
npm run ai:build && npm start -w @dor/worker   # worker, with the DOR_* worker env set
```
The worker's Droid calls use the **Factory Droid SDK** by default and need `FACTORY_API_KEY` on the worker host; without it the worker refuses to start. Set `DOR_DROID_TRANSPORT=cli` only to fall back to `droid exec` (a CLI login works there). See worker/README.md "SDK transport". `npm run setup:doctor -- --worker` checks this.

Run the worker under a supervisor that restarts it on a non-zero exit (pm2, systemd, a container restart policy, or `until npm start -w @dor/worker; do sleep 2; done` locally).
- The worker reconnects automatically after a dropped database connection, and does nothing while disconnected.
- If the database stays unreachable for `DOR_WORKER_MAX_OFFLINE_MS` (default 2 min), or the SDK gives up, the worker exits with code 1 so the supervisor restarts it.
- `GET /healthz` is 200 `{"ok":true}` when connected and 503 while disconnected.
- **Paid-run safety:** while the worker runs, every standing approved signal triggers a Droid call. Revoke test signals before starting it, and don't leave it running unattended.

## Reset (synthetic data only)
```sh
npm run setup:module -- --server dor-local --run --reset --i-understand-this-deletes-data
```
This republishes with `--delete-data`, re-applies owner config and re-mints nothing: run step 2 again afterwards, because the old worker allow-list row is gone. Clear browser site data for the app origin as well, because the local encrypted vault lives in IndexedDB and is not touched by a database reset.

## Demo: run and reset (local)
Local only; nothing here is a hosted deploy. Evidence so far is the local smoke (26/26, `--sweep` 30/30) recorded in README.

1. Start the local database (leave running; port 3100 avoids `next dev`):
   ```sh
   spacetime start --listen-addr 127.0.0.1:3100
   ```
   Stop it with Ctrl-C in that terminal (or end the `spacetime start` process).
2. Publish/bootstrap the module: `npm run setup:module -- --server dor-local --run`
3. Worker identity: `npm run setup:worker -- --server dor-local --run`
4. Start the app: `npm run dev` (runs `next dev` on :3000; `npx next dev` also works but skips the contracts/agents prebuild). Stop with Ctrl-C.
5. Smoke (optional): `node --env-file=.env.local --experimental-strip-types scripts/smoke-core3.ts`, add `--sweep` for the expiry-sweep check. It creates or reuses three synthetic `+clerk_test` Clerk dev users and leaves A's signal revoked. It does not run the worker.
6. Reset (DELETES ALL DATABASE DATA; synthetic data only):
   ```sh
   npm run setup:module -- --server dor-local --run --reset --i-understand-this-deletes-data
   npm run setup:worker -- --server dor-local --run    # required again: the worker allow-list row is gone
   ```
   Also clear browser site data for the app origin (the encrypted vault is in IndexedDB).

**Worker safety:** any standing approved signal causes a paid Droid call once the worker runs. Revoke test signals first and never leave the worker running unattended.

## Hosted deploy (not yet done)
Nothing below has been done; hosting is pending an owner decision.
- [ ] `spacetime login`; publish to maincloud
- [ ] `npm run setup:module -- --server maincloud --run` and `npm run setup:worker -- --server maincloud --run`
- [ ] Set `NEXT_PUBLIC_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com` (and `NEXT_PUBLIC_SPACETIMEDB_MODULE`, `DOR_SPACETIME_URI`, `DOR_SPACETIME_MODULE` to match)
- [ ] Vercel (or another host) with the Clerk env vars (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_SPACETIME_JWT_TEMPLATE`, `DOR_CLERK_ISSUER`, `DOR_AUTH_AUDIENCE`) and server-only keys (`CLERK_SECRET_KEY`, `ANTHROPIC_API_KEY`, `CARTESIA_API_KEY`, `DOR_WORKER_AUTH_TOKEN`); never use `NEXT_PUBLIC_` for secrets
- [ ] Clerk allowed origins/redirects for the production domain
- [ ] Worker host: a long-running Node process (not serverless) with `DOR_SPACETIME_WORKER_TOKEN`, `FACTORY_API_KEY`, `DOR_WORKER_AUTH_TOKEN` and the `DOR_SPACETIME_*` env
- [ ] HTTPS on the app origin (required for the PWA and microphone)
- [ ] Rerun `scripts/smoke-core3.ts` against hosted (`SMOKE_SERVER=maincloud`) and record revision and results

## Extensions (optional, not core)
Discover/Events UI is on by default (D045; hide with `NEXT_PUBLIC_DOR_DISCOVERY=off`). Bootstrap with `--extensions`, and load events with `node scripts/ingest-catalogue.ts --fixture src/lib/catalogue/fixtures/apify-sample.json --commit <db>` (synthetic) or `--fetch` after Cyber has reviewed the Apify task.

## Later: verification phase
Deferred by plan. The two-account journey, denied third account, revoke during generation, reconnect, microphone/provider failure and account-switch checks are listed in README "Core 3" and will be recorded with exact revision and results when run.
