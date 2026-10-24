# spacetimedb (Kinetic shared-state module)

TypeScript SpacetimeDB 2.x module. All tables are private; only the `my_*` views are public and each filters strictly by `ctx.sender`. Identity is always `ctx.sender` (never client-supplied). No journal, quiz, or transcript data is stored here.

Layout: `src/schema.ts` (tables), `src/guards.ts` (deterministic checks), `src/reducers/*`, `src/views.ts`, `src/index.ts` (exports reducers/views + default schema).

## Check
`npm run check -w @kinetic/spacetimedb-module` (tsc + vitest using the in-process `createModuleTestHarness`; no `spacetime` CLI needed).

## Publish / bindings
```
spacetime publish --module-path spacetimedb kinetic
spacetime generate --lang typescript --out-dir src/lib/spacetime/module_bindings --module-path spacetimedb
```
(The `spacetime` CLI was not available when this was written; publish/generate are untested here.)

## Clerk issuer config
External callers must present a JWT whose `iss` is in the `auth_config` table, otherwise `unauthenticated: ...`. `init` records the publisher in `module_owner`; only that identity (or an internal caller) may run:
```
spacetime call kinetic set_auth_issuer '"https://<your-clerk-frontend-api>"' true
```
The client must send the Clerk JWT (template `spacetimeConfig.jwtTemplate`) as the connection token. With an empty allow-list no external caller is admitted. Audience is NOT checked yet (open question for Cyber).

## Reducers / views
Reducers: `register_account`, `create_pair_invite`, `accept_pair_invite`, `unlink_pair`, `set_relationship_preset`, `assign_relationship_preset`, `approve_signal`, `revoke_signal`, `dismiss_nudge`, `snooze_nudge`, `set_nudge_delivery` (recipient-owned F5 settings), worker-only `commit_nudge` (F7), plus owner-only `set_auth_issuer` and `set_worker_identity`. Errors are `SenderError('<code>: message')` with codes from `ReducerErrorCode`. Timestamps in reducer args (`expires_at`, `until`) are ISO strings. `expected_version` / `expected_assignment_version` are `0` when creating.
Views: `my_account`, `my_pairs`, `my_invites`, `my_presets`, `my_preset_assignments` (owner only), `my_nudges` (recipient, not dismissed/suppressed, sources still standing), `my_signals` (sender only), `my_receipts` (sender only), `my_nudge_delivery` (own settings). Worker-only (empty for everyone else): `worker_signal_context`, `worker_delivery`.

## Placeholders (not final)
- `approve_signal` and `commit_nudge` enforce Cyber's single policy (`@kinetic/contracts/policy`, D026; see src/privacy/README.md). Nudges are created only by `commit_nudge` from an allow-listed worker identity; some older tests still seed nudges via internal writes from guarded signals.
- `my_receipts` and `my_signals` are sender-only (D026); `my_nudges` rechecks source-signal standing. Views cannot check expiry (no clock): a scheduled sweep is still needed.
- Recipient support-preferences consent (D021) has no table yet; live coordination must stay fail-closed.
- Build contracts before the module check (`npm run check:module` does this).
- Invite TTL (24h), snooze cap (30d) are placeholder constants in `src/constants.ts`.
- Receipts' `categories` for suppressed/revoked signals are derived from which fields the signal carries.
