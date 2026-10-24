# SpacetimeDB client adapter (CS)

`SpacetimeSharedState` implements `SharedStatePort` (`src/lib/backend/ports.ts`) over the
SpacetimeDB TypeScript SDK. Auth: Clerk JWT from `getToken({ template })` is the SpacetimeDB
token; `withTokenProvider` re-fetches it on reconnect. Cached rows are cleared on disconnect,
connect error, dispose, and identity change.

## Status today
`module_bindings/index.ts` is a committed PLACEHOLDER (`BINDINGS_GENERATED = false`). The adapter
reports `{ kind: 'unconfigured', reason: 'SpacetimeDB bindings not generated: run ...' }` and
`BackendProvider` serves the offline placeholder (reducers -> `{ ok:false, code:'unavailable' }`,
views empty) until BOTH bindings are generated AND `NEXT_PUBLIC_SPACETIMEDB_URI` is set.

## Go live
1. Module deployed: `spacetime publish kinetic --module-path spacetimedb` (name = `NEXT_PUBLIC_SPACETIMEDB_MODULE`).
   Module must allow the Clerk issuer for the JWT template.
2. Generate bindings (replaces the whole `module_bindings/` dir; only that dir changes):
   `spacetime generate --lang typescript --out-dir src/lib/spacetime/module_bindings --module-path spacetimedb`
3. `.env.local`: `NEXT_PUBLIC_SPACETIMEDB_URI`, `NEXT_PUBLIC_SPACETIMEDB_MODULE`,
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SPACETIME_JWT_TEMPLATE`
   (Clerk dashboard: create that JWT template).
4. Liveness is detected structurally: `bindings.ts` checks that `module_bindings` exports `DbConnection`.

## Where generated shapes are touched (adjust only if needed after generate)
- `bindings.ts`: loose facade; looks up reducers/tables by camelCase then snake_case name.
- `reducer_args.ts`: reducer argument objects (camelCase keys, `Timestamp`). If generated enums
  are tagged unions instead of strings, adjust here.
- `mappers.ts`: view row -> contract type (snake_case or camelCase columns; Zod-validated; rows
  that fail validation are dropped). Column names are assumed from the shared-context; confirm
  against generated view types.
- `views.ts`: subscribes with `SELECT * FROM my_*` for the seven views only.

Errors: reducers throw `SenderError('<code>: msg')`; `errors.ts` maps that to `ReducerResult`.
