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

## Reset (synthetic data only)
```sh
npm run setup:module -- --server dor-local --run --reset --i-understand-this-deletes-data
```
This republishes with `--delete-data`, re-applies owner config and re-mints nothing: run step 2 again afterwards, because the old worker allow-list row is gone. Clear browser site data for the app origin as well, because the local encrypted vault lives in IndexedDB and is not touched by a database reset.

## Extensions (optional, not core)
Set `NEXT_PUBLIC_DOR_EXTENSIONS=true`, bootstrap with `--extensions`, and load events with `node scripts/ingest-catalogue.ts --fixture src/lib/catalogue/fixtures/apify-sample.json --commit <db>` (synthetic) or `--fetch` after Cyber has reviewed the Apify task.

## Later: verification phase
Deferred by plan. The two-account journey, denied third account, revoke during generation, reconnect, microphone/provider failure and account-switch checks are listed in README "Core 3" and will be recorded with exact revision and results when run.
