# CS handoff
Status: Milestone 1 implemented on `role/cs-app`; offline-verified only. No live Clerk, SpacetimeDB, vault, or provider integration has run.

## Update at each handoff
- UTC timestamp and branch/commit: 2026-10-24T02:39Z, `role/cs-app`, commit "feat: CS milestone 1 app shell, identity seam, SpacetimeDB module" (see `git log origin/role/cs-app`).
- Completed work and interface IDs:
  - Next.js 16 App Router shell (`src/app`), Tailwind 4 + shadcn, nav: Home, Onboarding, Journal, Connections, Nudges, Privacy. Design pass ran (design-taste-frontend → impeccable → emil-design-eng).
  - Integration seam `src/lib/backend/ports.ts`: `SharedStatePort` (C2/C5 reducers + `my_*` views), `VaultPort` (C1, Cyber), `ReflectionPort` (C1, AI), `AdapterStatus` so UI shows honest live/unconfigured/not_implemented status. Hooks from `@/lib/backend`: `useSharedState`, `useVault`, `useReflection`, `useConnectionState`.
  - SpacetimeDB TS module `spacetimedb/`: private tables; reducers `register_account`, `create_pair_invite`, `accept_pair_invite`, `unlink_pair`, `set_relationship_preset`, `assign_relationship_preset`, `approve_signal` (refuses), `revoke_signal`, `dismiss_nudge`, `snooze_nudge`, owner-only `set_auth_issuer`; views `my_account`, `my_pairs`, `my_invites`, `my_presets`, `my_preset_assignments`, `my_nudges`, `my_receipts`, all filtered by `ctx.sender`. Errors `SenderError('<code>: msg')` with API.md codes.
  - Client adapter `src/lib/spacetime/`: Clerk JWT (template `NEXT_PUBLIC_CLERK_SPACETIME_JWT_TEMPLATE`) as SpacetimeDB token with refresh, reconnect, cache clear on disconnect/identity change, Zod-validated row mapping (invalid rows dropped).
- Verification (offline only, actual results): `npm run check` 12/12 pass; `npm run check:module` tsc + vitest 16/16 pass (in-process harness: third-user denial, self-accept, expired invite, stale versions, caller-filtered views, unlink/tightening suppression, approve_signal refused); `npm run typecheck` clean; `npx next build` succeeds; `npm run dev` serves all routes 200 with Clerk/SpacetimeDB unset.

## Working vs placeholder
| Piece | State |
|---|---|
| App shell, nav, pages, honest status UI | Working locally (unconfigured mode) |
| SpacetimeDB module reducers/views + guards | Working in in-process harness; NOT published |
| Client SpacetimeDB adapter | Written, typechecked, never connected. `src/lib/spacetime/module_bindings/` is a PLACEHOLDER until `spacetime generate` |
| Clerk auth + proxy | Wired, conditional on env; no keys, never exercised |
| Vault (journal/profile persistence) | PLACEHOLDER: locked, every write throws `vault pending (Cyber)`. Nothing persisted, no plaintext fallback |
| Reflection / voice | PLACEHOLDER: `reflection pending (AI)`, voice button disabled |
| approve_signal (C3) | Deliberately refuses `unavailable: policy guard pending (Cyber)`; no bypass |
| Nudges/receipts | Views real; rows only exist in tests (no producer yet) |

## Consumer and exact next action
- **Cyber:** (1) Review `spacetimedb/src/guards.ts`, `reducers/*.ts`, `views.ts`. (2) Implement policy guard inside `approve_signal` (params declared, unused) binding recipient, preset version, assignment version, consent version, expiry (C3/C6). (3) Implement `VaultPort` in `src/vault/` and tell CS to swap `placeholderVault` in `src/lib/backend/index.tsx`. Open questions: check JWT `aud` in addition to issuer? keep internal-caller bypass? should recipients see the preset kind assigned to them (hidden now)? 24h invite TTL, one active pair per user pair OK?
- **AI:** implement `ReflectionPort` (`src/lib/backend/ports.ts`) behind authenticated `POST /api/reflections` and voice session route; CS swaps `placeholderReflection`. Worker writes nudges must go through a version-checked reducer (to be added with Cyber guard).
- **DS:** quiz is 6 questions mapped to `LocalConnectionProfile` in `src/components/feature/quiz-model.ts`; dropped schedule-review and review-comfort questions (no profile field). Confirm or supply copy/mapping for 8.
- **CS (me) next:** install spacetime CLI, `spacetime start`, `npm run` publish + `spacetime generate`, create Clerk app + JWT template, `set_auth_issuer`, two-account live invite/accept smoke test, Vercel preview (only when asked).

## Blockers / unresolved contract decisions
- `spacetime` CLI install was denied in agent session; publish/generate untested. Needs human: `curl -sSf https://install.spacetimedb.com | sh`.
- No Clerk keys / JWT template; no hosted SpacetimeDB database.
- `npm ci` requires `.npmrc` `legacy-peer-deps=true` (npm 11 arborist crash on vitest→jsdom optional peer).

## Run
```sh
npm ci
npm run check:all      # contracts + module harness + app typecheck
npm run dev            # http://localhost:3000, unconfigured mode without env
```
