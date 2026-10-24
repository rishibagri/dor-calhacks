# Required agent entry point
Read this file before working, including after resuming. Human owners and their coding agents follow the same contracts.

## Read order
README.md → PRD.md → PROJECT_KNOWLEDGE.md → contracts/README.md → docs/PLAN.md → docs/TECH_STACK.md → contracts/specs/*.md → your docs/roles/<role>.md and docs/handoffs/<role>.md → all role update logs.

## Contract-first development
C1 local profile/reflection; C2 presets/recipient assignment; C3 approved disclosure; C4 agent ACK/coordination; C5 nudge/receipt; C6 policy and offline test boundary. Producer/consumer ownership is in contracts/README.md. Import only @kinetic/contracts across workstream boundaries. Do not reach into another owner's internals or duplicate wire types. Build against explicit fixtures/fakes until real adapters exist; never import fakes into production mode.

## Setup and evidence
Run `npm ci` and `npm run check` at the repository root. These verify offline contracts only. Regenerate schemas with `npm run contracts:schema` after shape changes and update fixtures in the same PR. Never claim the application runs from these commands. Record planned, implemented, deployed and live-verified status separately in PROJECT_KNOWLEDGE.md.

## Shared contract visibility
All architecture, API, agent protocol, privacy, acceptance, and data contracts are shared on `main` and available to every teammate and agent. `main` is authoritative; do not maintain branch-specific private contracts. Merge shared contract updates from `main` into each role branch before dependent work. Separate video/presentation planning lives in docs/DEMO.md and is not required engineering-contract reading.

## Selected stack
Kinetic uses Next.js/React/TypeScript, Tailwind/shadcn, SpacetimeDB reducers/private tables/caller-filtered views, Claude, Factory Droid, Cartesia, TypeScript/Zod, and IndexedDB/Web Crypto. Read docs/TECH_STACK.md before choosing dependencies. Never reintroduce server-stored journals or assume a quiz grants disclosure consent.

## Operating rules
- Work only on your role branch. Sync main before integration. Small PRs every 2–3 hours; CS owns integration and does not become the sole implementer.
- Claim files/task in the update area before editing shared surfaces. Own your directories. Ask the affected role before changing shared interfaces; record decisions in docs/DECISIONS.md and version contracts together.
- Contracts are normative proposals, not evidence that protections exist. Never weaken privacy gates to make a feature work. Block uncertain disclosure.
- Journal audio, transcripts, embeddings, inferred sensitive facts, and private summaries must never enter shared agent state, peer prompts, analytics, Git, issues, or agent update files.
- No provider keys in clients or commits. Use synthetic data. No autonomous messages impersonating users. Delivery is in-app; sending a personal message requires user action.
- Verify authentication, ownership, consent scope/version/expiry, pair membership, unlink state, and output allowlists on the server. A prompt is not an authorization boundary.
- No claim of end-to-end encryption, zero provider retention, or guaranteed secrecy from inference without an implemented, verified design.
- Meaningful tests: cross-user access, disclosure/revocation races, injection, payload rejection, end-to-end core journey. Report failures honestly.

## Continuous agent update area
Maintain the dashboard below when a change reaches main. During branch work, append to your own docs/updates/<role>.md (cs, ds, cyber, ai), so four people do not overwrite one file. Read all four logs before starting, before interface changes, and at least every 60 minutes. Push each meaningful handoff. Until merged, readers must inspect the corresponding remote role branch; local files do not magically synchronize across branches.

Update format: UTC timestamp | owner | task | status | branch/commit | files/interfaces changed | verification | next handoff | blockers. Never include personal journal data or credentials. Tag the target role and include exact next action. ACK incoming blockers in your role log. Raise blocked interfaces within 15 minutes.

| Role | Current status | Next handoff |
|---|---|---|
| CS | M1 merged (PR #1); D015 fixture/quiz fix on role/cs-app @ d6e9a6b, PR pending. Shell, SpacetimeDB module (16 harness tests), Clerk-JWT adapter written; nothing live yet | Logic/flow review (signal preview + approval loop) before API work; then publish module + live two-account smoke test |
| DS | Planned | Build fixtures on updated `contracts/fixtures/scenarios.json` (each scenario now has `confirmedPreset` + `presetAssignment`; friends omits availability). Use quiz `prefersSpace` / empty `preferredSupportModes` as a no-action case. Ref: D015 |
| Cyber | M1 on role/cyber-privacy @ 129c31f (PR pending): C6 guards in `@kinetic/contracts/policy`, authoritative `approve_signal`, sender-only `my_signals`/`my_receipts`, vault design (`src/vault/DESIGN.md`). Offline only: contracts 40/40, module 36/36; module not published | CS: ACK D017, compute `payloadRevision` in preview, ACK VaultPort additions, add JWT `aud` check. AI: live worker uses `DisclosurePolicy`; co-design `commit_nudge`. Cyber next: vault crypto + IndexedDB adapter |
| AI | Planned | Implement `ReflectionPort` (`src/lib/backend/ports.ts`) behind authenticated `POST /api/reflections` + voice session route. Note: friends `approvedSignal` fixture no longer has `availability` |

## Ownership and handoffs
Use the ownership table in README.md. CS owns SpacetimeDB module plumbing; Cyber owns reusable authorization semantics and reviews the boundary. Shared contract edits need affected producer/consumer review. Before pausing or handing off, update docs/handoffs/<role>.md and your role log with branch/commit, exact interface, evidence, next consumer action and blocker. Refresh PROJECT_KNOWLEDGE.md after significant merges.

## Completion checklist
Contract compatibility, meaningful checks, privacy review for boundary changes, updated role log, reproducible verification instructions. Never mark a stub, replay, or mocked provider as live integration.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Handoff log (append newest at the bottom)

### 2026-10-24T03:30Z | Cyber → CS, AI, DS | M1 disclosure guards + vault design
- **Branch/commit:** `role/cyber-privacy` @ `129c31f` (based on main @ `8e208df`). PR to main pending; read the remote role branch until merged.
- **Status:** implemented and offline-verified, NOT live. `npm run check:all` exit 0 (contracts 40/40, module 36/36, typecheck, app tests 4/4); `next build` ok; audit 0. The SpacetimeDB module has never been published.
- **Interfaces:**
  - `@kinetic/contracts/policy` (no runtime dependencies; safe inside reducers) exports:
    - `guardApproval`, `guardSignalUse`, `guardSignalStanding`, `guardNudgeCommit`
    - `payloadRevision`, `policyErrorCode`
    - constants `SIGNAL_LIFETIME_MS` and `DISCLOSURE_CONSENT_VERSION`
  - `DisclosurePolicy` (`@kinetic/contracts`) is the real `DisclosurePolicyPort` for routes and the worker.
  - `approve_signal` enforces the guard and the table gained `client_request_id`.
  - New sender-only `my_signals` view; `my_receipts` is now sender-only; `my_nudges` rechecks that each source signal is still valid.
  - Decision D017.
- **CS next:**
  1. ACK D017.
  2. In the preview route, compute `payloadRevision({pairId, recipientId: counterpartHex, supportMode, availability, recipientPolicyVersion, presetAssignmentVersion, consentVersion: DISCLOSURE_CONSENT_VERSION})` and pass it unchanged to `approve_signal`.
  3. Use `my_signals` in the privacy center.
  4. Regenerate bindings after publish.
  5. ACK the VaultPort additions in `src/vault/DESIGN.md`.
  6. Add a JWT `aud` check.
  7. Publish the module and rerun `spacetimedb/tests/disclosure.test.ts` scenarios live with two test accounts.
- **AI next:** in live mode, replace `FakeDisclosurePolicy` with `new DisclosurePolicy(reader, clock)`; the reader must load authoritative state. Co-design the `commit_nudge` reducer and worker identity with CS.
- **DS next:** no-action eval cases assert guard reason codes (`expired`, `revoked`, `unlinked`, `stale_policy`, `blocked_category`, `no_consent`).
- **Open gaps:**
  - No `commit_nudge` reducer and no worker identity.
  - No expiry sweep (views have no clock).
  - No recipient nudge opt-in.
  - No rate limiting.
  - JWT `aud` is not checked.
  - The CLI bundler's resolution of `@kinetic/contracts/policy` is untested.
- **Details:** `docs/handoffs/cyber.md`, `docs/updates/cyber.md`, `src/privacy/README.md`.
