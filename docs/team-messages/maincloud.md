# Shared SpacetimeDB on Maincloud: setup per person (Adam, 2026-10-24)

The shared database is `dor` on `wss://maincloud.spacetimedb.com`. **Nimisha's `spacetime login` owns it**: only that login can publish, run `set_*` admin reducers or read private tables. Never use `--delete-data` or `--reset` on it. Module source: main `3bf3e25` (D045/D046 and the CS transition-first app merged; no module change since `c8a8e35`; `bindings:check` ok).

## State (2026-10-24, after the owner setup below)
- **Done by Nimisha:** republished from main `3bf3e25`. The migration plan was empty, so data was kept and the database identity `c200c206…dc14` is unchanged. Issuer and audience are set, the discovery areas, tags and source hosts are loaded, and `enabled` is OFF. Every step 3 check passed: no active approved signals, no scheduler-auth errors, `bindings:check` ok with no drift.
- The only allow-listed worker is `0xc200188a51e700975ab1b1392de8783df7ba4664619e68e8894d6fb695225ce5` (Adam). The unused `0xc200f05e…78c6` was removed and its token file deleted. Adam's worker reconnected after the republish (`/healthz` ok).
- **Audience renamed (2026-10-24):** the Clerk `spacetimedb` template has issued `aud: dor-spacetimedb` since 23:01:57Z. The module allow-list held both names during the switch. Once the old one is removed it holds only `dor-spacetimedb`; until then it still accepts `kinetic-spacetimedb`. Everyone's `DOR_AUTH_AUDIENCE` is `dor-spacetimedb`.
- The denied `set_worker_identity` at 22:09:36Z in the logs was Adam's non-owner `setup:worker --run`. It's expected, and the owner then allow-listed his worker.
- **Live-verified on Maincloud (2026-10-24 ~23:00Z, module from main `3bf3e25`):** `scripts/smoke-core3.ts` run by a non-owner (`SMOKE_TAG=adam`, worker stopped) gave **26/26 PASS**. Covered: Clerk iss/aud accepted by the module (register), pairing and invite reuse refused, preset and assignment, opt-in and support preferences, approve with sender-only views, third account denied on approve, revoke and all views, wrong revision refused (`stale: stale_policy`), recipient can't revoke, revoke plus replay doesn't resurrect, reconnect is consistent, garbage token refused at connect, anonymous refused (`issuer not allow-listed`). A's signal is left revoked.
- **Not verified yet:** `--sweep` 10c (owner run), Clerk sign-in through the browser app, the worker's paid nudge run (Stage C).

## Nimisha (owner): run once, from main `3bf3e25` or later (done 2026-10-24; kept for a rebuild)
Needs `.env.local` with `DOR_CLERK_ISSUER=https://premium-goshawk-4765.clerk.accounts.dev`, `DOR_AUTH_AUDIENCE=dor-spacetimedb` (the `aud` of the Clerk `spacetimedb` JWT template) and `NEXT_PUBLIC_SPACETIMEDB_MODULE=dor`, and the owner `spacetime login`.

```sh
git checkout main && git pull && npm ci

# 1. Republish main's module (code-only change, data kept) and apply owner config:
#    issuer, audience, discovery areas/tags/source hosts, discovery flag OFF, bindings.
npm run setup:module -- --server maincloud          # prints the plan; check there is no --delete-data
npm run setup:module -- --server maincloud --run

# 2. Remove the unclaimed worker identity (skip if someone holds its token)
spacetime call -s maincloud dor set_worker_identity '{"__identity__":"0xc200f05e8c630887260f2c34dfb5916d5431b5cc7a02de6a459f26fc4c9478c6"}' false

# 3. Verify
spacetime sql -s maincloud dor "SELECT * FROM auth_config"       # the Clerk issuer
spacetime sql -s maincloud dor "SELECT * FROM auth_audience"     # dor-spacetimedb (only)
spacetime sql -s maincloud dor "SELECT * FROM worker_identity"   # only 0xc200188a…5ce5
spacetime sql -s maincloud dor "SELECT * FROM discovery_config"  # areas, tags, source_hosts; enabled empty
spacetime logs -s maincloud dor | tail -40                       # no "unauthorized: scheduler only"
```

For Cyber's deployed verification run (`src/privacy/LIVE_VERIFICATION.md` §2–5) only, turn discovery on, and off again afterwards unless Phase 5 is signed off:
```sh
spacetime call -s maincloud dor set_discovery_config '"enabled"' '["true"]'   # on, for the run
spacetime call -s maincloud dor set_discovery_config '"enabled"' '[]'         # off again
```

## Everyone: `.env.local`
```
NEXT_PUBLIC_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com
NEXT_PUBLIC_SPACETIMEDB_MODULE=dor
DOR_CLERK_ISSUER=https://premium-goshawk-4765.clerk.accounts.dev
DOR_AUTH_AUDIENCE=dor-spacetimedb
```
`CLERK_SECRET_KEY` (dev) and `DOR_WORKER_AUTH_TOKEN` come through the password manager, never chat or git. The app and the worker must use the same `DOR_WORKER_AUTH_TOKEN`. Check with `npm run setup:doctor` (add `-- --worker` on the worker host).

## Anyone: live smoke against Maincloud (no owner login needed)
```sh
npm run ai:build
SMOKE_SERVER=maincloud SMOKE_TAG=<yourname> node --env-file=.env.local --experimental-strip-types scripts/smoke-core3.ts
```
- `SMOKE_TAG` gives you your own synthetic A/B/C Clerk test users, so parallel runs don't collide.
- Without the owner login, the allow-list check is done through `register_account` (step 1), and the `--sweep` marker check (10c) is reported as `SKIP`. The owner can run `--sweep` for 10c.
- **Cost:** free while the worker is stopped. If Adam's worker is running, step 5a's approved signal costs about 1–3 Droid SDK calls (~256 Factory credits each). Ask Adam first.

## Worker (Adam)
```sh
npm run ai:build
until node --env-file=.env.local worker/dist/main.js; do sleep 2; done   # the worker doesn't read .env.local itself
curl localhost:8787/healthz                                              # {"ok":true}
```
Every standing approved signal becomes a paid Droid call while the worker runs. Never leave it unattended.

## What the D045 pivot changes here
- Discovery is now the core journey, but the module's discovery flag stays **off** on Maincloud until Cyber's live verification run (`src/privacy/LIVE_VERIFICATION.md`). The app's Discover/Events UI is on by default since main `3bf3e25` (`NEXT_PUBLIC_DOR_DISCOVERY=off` hides it; `NEXT_PUBLIC_DOR_EXTENSIONS` is gone). The module flag is the authority, so with it off those pages render but the module refuses discovery actions.
- Discovery makes zero model calls (README AI Phase 1). The worker serves the existing-pair nudge path and plans.
- **D048 (on `role/ai-voice`, not yet published):** viewer-initiated introduction suggestions. It adds one table (`introduction_suggestion_request`), two reducers (`request_introduction_suggestion`, `close_introduction_suggestion_request`) and two views (`worker_introduction_requests`, `my_introduction_suggestion_request`). The migration is additive; existing tables are unchanged.
  - After merge, the owner (Nimisha) republishes from main without `--delete-data`, then confirms `spacetime describe` lists the new views.
  - Until then, the new "Suggest someone for me" button returns an error and the worker logs `introductions enabled 0` against the old module. Nothing else changes.
  - The worker default `DOR_WORKER_INTRODUCTIONS=deterministic` makes zero Droid calls.
- The core-path regression (LIVE_VERIFICATION §6: pause, narrow `my_nudges`, sender-only receipts) can already run against this database.
