# spacetimedb (dor shared-state module)

TypeScript SpacetimeDB 2.x module. All tables are private; only the `my_*` views are public and each filters strictly by `ctx.sender`. Identity is always `ctx.sender` (never client-supplied). No journal, quiz, or transcript data is stored here.

Layout: `src/schema.ts` (tables), `src/guards.ts` (deterministic checks), `src/reducers/*`, `src/views.ts`, `src/index.ts` (exports reducers/views + default schema).

## Check
`npm run check -w @dor/spacetimedb-module` (tsc + vitest using the in-process `createModuleTestHarness`; no `spacetime` CLI needed).

## Publish / bindings
```
spacetime publish --module-path spacetimedb dor
spacetime generate --lang typescript --out-dir src/lib/spacetime/module_bindings --module-path spacetimedb
```
(The `spacetime` CLI was not available when this was written; publish/generate are untested here.)

## Clerk issuer config
External callers must present a JWT whose `iss` is in the `auth_config` table, otherwise `unauthenticated: ...`. `init` records the publisher in `module_owner`; only that identity (or an internal caller) may run:
```
spacetime call dor set_auth_issuer '"https://<your-clerk-frontend-api>"' true
```
The client must send the Clerk JWT (template `spacetimeConfig.jwtTemplate`) as the connection token. With an empty allow-list no external caller is admitted. The token's `aud` must also be allow-listed (D035; set a fixed `aud` in the Clerk JWT template):
```
spacetime call dor set_auth_audience '"dor-spacetimedb"' true
```
Empty audience allow-list = every user reducer fails `unauthenticated`. Views can't check claims (src/privacy/README.md known gaps).

## Reducers / views
Reducers (D041 core): owner-only `pause_recipient` and `resume_recipient`. Reducers: `register_account`, `create_pair_invite`, `accept_pair_invite`, `unlink_pair`, `set_relationship_preset`, `assign_relationship_preset`, `approve_signal`, `revoke_signal`, `dismiss_nudge`, `snooze_nudge`, `set_nudge_delivery` (recipient-owned F5 settings), `set_support_preferences` / `revoke_support_preferences` (recipient-owned C4 consent, D035), worker-only `commit_nudge` (F7; binds `recipient_consent_id/version`), scheduler-only `sweep_expired`, owner-only `set_auth_issuer`, `set_auth_audience`, `set_worker_identity` and `set_discovery_config`, and proposed C8 `publish_discovery_profile`, `withdraw_discovery_profile`, `set_discovery_area`, `block_discovery_user`, plus D038 `send_introduction_request`, `respond_introduction_request`, `cancel_introduction_request`, `block_introduction_participant`, `report_discovery_user`, `dismiss_introduction_proposal` and worker-only `commit_introduction_proposal`, plus D039 ingester-only `upsert_catalogue_event`, `publish_event_intent`, `revoke_event_intent`, `approve_activity_interest`, `revoke_activity_interest`, `respond_plan`, `cancel_plan` and worker-only `commit_plan_proposal` / `revise_plan_proposal` (disabled until the owner enables discovery; per-caller daily limits, see src/privacy/DISCOVERY_ENFORCEMENT.md). Errors are `SenderError('<code>: message')` with codes from `ReducerErrorCode`. Timestamps in reducer args (`expires_at`, `until`) are ISO strings. `expected_version` / `expected_assignment_version` are `0` when creating.
Views: `my_account`, `my_pairs`, `my_invites`, `my_presets`, `my_preset_assignments` (owner only), `my_nudges` (recipient; not dismissed/suppressed/snoozed; sources and bound consent still standing), `my_signals` (sender only), `my_receipts` (sender only), `my_nudge_delivery` and `my_support_preferences` (own settings), `my_discovery_profile`, `discovery_cards` (proposed C8 projection), `my_introductions` and `my_introduction_proposals` (D038), `catalogue_events`, `my_event_intents`, `event_companions`, `my_activity_approvals`, `my_plans` (D039). Owner-only D041 view: `my_recipient_pauses`. Worker-only (empty for everyone else): `worker_signal_context`, `worker_delivery`, `worker_support_preferences`, `worker_plan_candidates`.

## Placeholders (not final)
- `approve_signal` and `commit_nudge` enforce Cyber's single policy (`@dor/contracts/policy`, D026; see src/privacy/README.md). Nudges are created only by `commit_nudge` from an allow-listed worker identity; some older tests still seed nudges via internal writes from guarded signals.
- `my_receipts` and `my_signals` are sender-only (D026); `my_nudges` rechecks source-signal standing and the bound recipient consent. Views have no clock: `init` schedules `sweep_expired` every 60 s, which suppresses expired nudges, ends snoozes and writes `expired_record` markers that views honour (stale window ≤ 60 s).
- Build contracts before the module check (`npm run check:module` does this).
- Invite TTL (24h), snooze cap (30d) are placeholder constants in `src/constants.ts`.
- Receipts' `categories` for suppressed/revoked signals are derived from which fields the signal carries.
