# Maincloud release and smoke-test plan

Owner: Nimisha (Maincloud `dor` module owner). Every step marked **owner** runs under the owner's `spacetime login`.
Never use `--delete-data`, `--reset` or `-c`, and never delete or recreate the database. Nothing in this file has been run against Maincloud yet.

## 1. Release: code-only republish for #64

**State:**
- Maincloud runs `5bed0ee` (republished 2026-10-25T04:25Z): 35 tables, 49 reducers, 28 views.
- #64 (catalogue URLs parsed without the `URL` global) merged to main at `13d0b73`. It is the only module-bundled change since `5bed0ee`: `contracts/src/catalogue.ts`, with no `spacetimedb/` change and no schema change.
- Without this republish, Maincloud refuses every catalogue event that has a source link (`unsafe_source_url`).

**Pre-flight (read-only):**
1. In a clean worktree, run `git fetch && git switch --detach origin/main` and record the commit `<C>`.
2. Run `git diff --stat 5bed0ee <C> -- spacetimedb contracts/src`. Expect only `contracts/src/catalogue.ts`. Anything else, such as the module tests from #66, means re-reviewing what changed. Module test files aren't bundled.
3. **Local rehearsal on a disposable database:**
   1. `spacetime start --listen-addr 127.0.0.1:3300 --in-memory --non-interactive`.
   2. Publish `5bed0ee`, then publish `<C>` over it **without** `--delete-data`, both with `-s http://127.0.0.1:3300`. The upgrade must be accepted with no migration prompt.
   3. Run `node scripts/ingest-catalogue.ts --fixture src/lib/catalogue/fixtures/apify-sample.json --commit <db> --server http://127.0.0.1:3300`. Events must load with their `source_url`.
4. **Owner snapshot** (read-only on Maincloud): save `spacetime describe -s maincloud dor --json` and the row counts of the main tables (`spacetime sql -s maincloud dor "SELECT COUNT(*) FROM <table>"`) to a file.

**Publish (owner):**
5. `npm ci && npm run build -w @dor/contracts && spacetime publish -s maincloud --module-path spacetimedb -y dor`. If the CLI reports a schema change or asks about data, **stop**: this release has no schema change.

**Post-publish (read-only):**
6. Describe again and confirm the counts are unchanged (35 / 49 / 28), the schema is identical except for the program hash, the table row counts match step 4, and `spacetime logs -s maincloud dor -n 100` shows no errors.
7. The running worker reconnects by itself. Check its `/healthz`, or restart it.

**Rollback:** republish `5bed0ee` the same way (code-only and schema-compatible).

**Not part of this release:** loading real catalogue data. The first production ingest is a separate owner decision: `--fetch` after Cyber's review of the Apify task, with an explicit `--commit dor --server maincloud` (#65). Synthetic fixtures never go to Maincloud.

## 2. Smoke test on real Maincloud (authorized test identities)

**These tests write synthetic rows to production.** Run them only after the owner explicitly approves that specific run.

**Identities:**
- `dor-smoke-{a,b,c}-<tag>+clerk_test@example.com`: Clerk dev test users created by `scripts/smoke-core3.ts`, one set per `SMOKE_TAG` so runs never collide.
- The allow-listed worker identity (`0xc200188a…5ce5`) for the worker phase. Never a real person's account and never real data.

| Phase | Who | What | Pass criteria |
|---|---|---|---|
| P0 read-only | owner | Describe, counts and logs (as in step 6); anonymous and worker denial checks | No schema drift; anonymous sees 0 rows; the worker can't call owner reducers |
| P1 core, no worker | any teammate | `SMOKE_SERVER=maincloud SMOKE_TAG=<tag> node --env-file=.env.local --experimental-strip-types scripts/smoke-core3.ts`; the owner adds `--sweep` | 26/26 (the last hosted run was 26/26 on `3bf3e25`) |
| P2 worker, no model | owner + teammate | Start the worker from `deploy/worker` with `DOR_DROID_TRANSPORT=off`. A approves one signal for B, who is opted in with support consent. Then revoke it | B gets exactly one `{id, pair_id, template_id, visible_until}` row; worker logs `decidedBy: fixed_template` and `droid_call … not_configured` (0 credits); C sees nothing; after the revoke the nudge disappears |
| P3 D049, after #66/#67 merge | teammate | Save a preset with `activityInterestAllowed`; call `approveActivityInterest` for the pair; re-save without the flag | The preset stays visible with the flag and `unreadable().counts` stays `{}`; the approval appears in `my_activity_approvals`; signals and nudges never mention activity |
| P3b discovery, only if the owner enables it | teammate | Suggestion request goes `open` → `done`; an accepted introduction creates no pair | As in the local journey (#67). Discovery is **off** on Maincloud; turning it on is a separate owner decision |
| P4 cleanup | each runner | Revoke test signals, standing consents and activity approvals; unlink test pairs; stop the worker unless it is meant to stay up | No active test signal remains. With `off` mode, nothing can trigger a paid call |

P2 and P3 have no script yet (P1's script deliberately doesn't run the worker). Run them by hand from the app or a small script modeled on `scripts/smoke-core3.ts`, under the same synthetic-identity rules.

**Stop conditions:** stop immediately if the third account sees data, a guard accepts what it should refuse, the owner path is refused unexpectedly, or the logs show module errors. Don't retry writes to "make it pass". Roll back (section 1) only if the module itself regressed.

**Record:** add the commit, UTC time, runner, phase results and anything skipped to `PROJECT_KNOWLEDGE.md`, keeping live-verified separate from offline.
