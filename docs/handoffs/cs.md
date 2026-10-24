# CS handoff — 2026-10-24T19:00Z, role/cs-app (PR #22)

Status: CS-R1 complete in code, CS-R2 complete in code. **Offline-verified only**: the module has not been published, no two-account run, no browser geolocation or network trace.

## Interfaces now available
- `SharedStatePort` (`src/lib/backend/ports.ts`): support preferences, nudge delivery, signals (`mySignals`), discovery publish/withdraw/area/page/block, introduction send/respond/cancel/block/report, proposal dismiss; views `myDiscoveryProfile`, `discoveryCards`, `myIntroductions`, `myIntroductionProposals`, `unreadable()`.
- Module (CS plumbing, Cyber to review): btree indexes on `discovery_publication.owner`, `area_participation.area_key`, `discovery_block.blocker/blocked`, `introduction.sender/recipient`; `discovery_cards` reads only the viewer's area, card-ref order, after the caller's own `discovery_page` cursor, hides accepted introductions; new `set_discovery_page(after_ref)`. Tests: `spacetimedb/tests/discovery_cards.test.ts` (6).
- Config: `src/lib/discovery/config.ts` (areas + tags); load into the module with the output of `node scripts/discovery-config.ts [db] [--enable]`.
- `reportCard(shared, ref, reason)` in `src/components/feature/introduction-actions.ts`, ready for DS's `onReport`.

## Next consumer actions
- Cyber: review the index/cursor/connected-filter change in `views.ts`, `policy_state.ts`, `discovery_effects.ts`, `schema.ts`, `reducers/discovery.ts`.
- DS: when `DiscoveryResults` gains `onReport`, CS passes `reportCard` (one line in `src/app/discover/page.tsx`).
- AI: worker job calling `commit_introduction_proposal`; profile revisions are on cards and `my_discovery_profile`.
- CS next: R3 events on D039.

## Verification
`npm run check:all` exit 0 (contracts 116, module 143, app 223 + 1 known a3 todo); `npm run ai:check` exit 0; `npx next build --webpack` OK.

---

# Local Desktop reconciliation — pushed in codex/cs-app-integration PR

Current workspace now contains GitHub main `250d4bf` plus uncommitted source changes from `/Users/rishii3/Desktop/calhacks` (generated bindings and worker build/runtime loader). Desktop source, its local configuration, SESSION.md and phase-2 stash remain untouched. Local ignored configuration was imported with owner-only permissions; variable names match DOR_* while configured values were preserved. Never commit configuration or local session notes.

Offline verification: check:all passes (95 contracts, 84 module, 158 app + 1 known TODO), ai:check passes (64 agent, 21 worker, 19 integration). No live provider run. Clerk is configured; provider/worker credentials still need completion. Generated bindings exist but are not proof of a published, correctly authorized end-to-end app. The newer main rename supersedes the Desktop package/env names. Review historical instructions below by commit rather than treating old pending items as current.

---

# Planning reset notice — current main d7285eb

Read `docs/roles/cs.md` and README **R0–R6** for current assignments. The historical implementation handoff below is preserved; statements such as “not merged” describe its original commit. Current status is in PROJECT_KNOWLEDGE.md. This notice is not a consumer ACK or evidence of live verification. New scope: existing connections + opted-in nearby public profiles + local-event introductions. One-time approximate location; no inherited pair consent. Forwardable update: `docs/team-messages/cs.md`.

---

# Current coordination update — CS (you)

Read your updated detailed plan in docs/roles/cs.md and shared README.md phases. Task IDs are CS-P#; Cyber uses CYBER-P#. CS owns Apify ingestion; Nimisha matching; Adam bounded proposals; Sumedh disclosure/vault. Preserve existing work and review the main/role-branch status before selecting the first unmet phase. Forwardable message: docs/team-messages/cs.md. This notice does not ACK or complete any pending implementation/contract review.

---

# CS handoff
Status: Milestone 1 implemented on `role/cs-app`; offline-verified only. No live Clerk, SpacetimeDB, vault, or provider integration has run.

## Update at each handoff
- UTC timestamp and branch/commit: 2026-10-24T02:39Z, `role/cs-app`, feature commit `082ab47` (handoff doc follow-up on top).
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
- **DS:** D015 applied. `contracts/fixtures/scenarios.json` now includes explicit `confirmedPreset`/`presetAssignment` per scenario (friends = support only, signal omits availability; family = both, marked `owner_selected_beyond_suggestion`). Quiz is 8 questions; Q1 "space" -> no support mode (`LocalQuizExtras.prefersSpace`, use as no-action case); Q5/Q6/Q8 stored only via `VaultPort.saveQuizExtras` (local). Build fixtures on this.
- **Cyber (D015):** review fixture preset records (privacy boundary) and implement `saveQuizExtras`/`loadQuizExtras` in the vault.
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
