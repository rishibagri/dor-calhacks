# Required agent entry point
Read this file before working, including after resuming. Human owners and their coding agents follow the same contracts.

## Read order
README.md → PRD.md → PROJECT_KNOWLEDGE.md → contracts/README.md → docs/PLAN.md → docs/TECH_STACK.md → contracts/specs/*.md → your docs/roles/<role>.md and docs/handoffs/<role>.md → all role update logs.

## Contract-first development
C7 includes executable catalogue-input/link guards but shared activity types remain pending; C8 discovery publication/area/event-intent is proposed in contracts/specs/DISCOVERY.md. New scope never silently broadens C3 or D028.

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

| Role / person | Current status | Next handoff |
|---|---|---|
| CS — you | App/quiz/client adapter implemented; app composition still uses placeholders; actual bindings/auth/deployment unverified | CS-R1: compose real vault/voice features and generate bindings; CS-R2/R3: coarse-area discovery state and one Apify catalogue |
| DS — Nimisha | role/ds-context b077a1e (local, unpushed): `rankNearby` shortlist + `src/features/discovery` components + 15 nearby cases; rankActivities uses safeCatalogueUrl/allowInPerson. Offline/synthetic | CS: compose DiscoveryResults/EventResults and ship C8 candidate query matching `src/features/discovery/types.ts`; Sumedh: confirm projection; Adam: ≤3-entry shortlist; team: ratings |
| Cyber — Sumedh | d7285eb includes real vault, unified guards, opt-in, worker-only commit/views and Apify guards; offline only | CYBER-R1: recipient preference consent + commit binding, expiry/audience and privacy component; R2: publication/block guards |
| AI — Adam | PR #7 merged: routes/browser helpers, real-policy worker factory, replay ledger and cheaper Droid; isolated Droid evidence only | AI-R1: voice component + worker database adapters; R2/R3: bounded introduction/event workflow; R4: call budgets |

R0–R6 replace the old P-phase schedule without resetting code or the original deadline. Detailed shared phases are in README.md; per-owner phases in docs/roles/*.md; exact producer/consumer dependencies in docs/PLAN.md. These are current planning assignments, not completion evidence. Merge main into your active role branch; do not reset or force-update other roles.

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
  - Decision D026.
- **CS next:**
  1. ACK D026.
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

### 2026-10-24T05:30Z | Cyber → CS, AI, DS | CYBER-P2/P3: one policy, F5/F7 enforcement, real vault, C7 boundary
- **Branch/commit:** `role/cyber-privacy` @ `34e70f7`. Merged `origin/main` @ `982cfb0` (no reset). PR #6 to main is open; read the remote role branch until it merges.
- **Status:** implemented and offline-verified, NOT live. The SpacetimeDB module is unpublished, and harness results do not prove deployed isolation.
- **Evidence:**
  - `npm run check:all` exits 0: contracts 63/63, schemas current, module 52/52, app typecheck, app tests 79/79.
  - `npm run ai:check` exits 0 (agents 34, worker 6).
  - `next build` ok; npm audit 0.
  - Mutation checks: removing the opt-in, template, source-recheck, worker-check, worker-view gate, replay-resurrection, record-AAD, IV, key-extractability, lock or recovery-rotation protections each fails tests.
- **File claims (CS please ACK; please don't edit these concurrently):**
  - `spacetimedb/src/reducers/{signals,delivery,coordination}.ts`, `spacetimedb/src/policy_state.ts`
  - Cyber-added parts of `schema.ts` (`nudge_delivery`, `worker_identity`, `approved_signal.client_request_id`), `views.ts` (`my_signals`, `my_receipts`, `my_nudges` recheck, `my_nudge_delivery`, `worker_*`) and `admin.ts` (`set_worker_identity`)
  - `src/vault/**`, `src/privacy/**`, `contracts/src/{policy,policy-port,catalogue}.ts`
- **CS next:**
  1. ACK D026, D028 and the VaultPort additions in `src/lib/backend/ports.ts`.
  2. Swap `placeholderVault` for `new LocalVault({ store: new IndexedDbVaultStore(indexedDB, 'kinetic-vault:' + sha256(userId)) })`. Subscribe with `useSyncExternalStore(vault.subscribe, vault.getVersion)`. Add create / unlock / show-recovery-code-once / recover screens.
  3. Device preview via `previewDisclosure`, then `approve_signal` with `payloadRevision` (src/privacy/README.md).
  4. Recipient opt-in UI (`set_nudge_delivery`, default off).
  5. Apify adapter must build inputs only via `guardPublicCatalogueQuery`.
  6. Publish, `set_worker_identity`, live two-account smoke.
- **AI (Adam) next:**
  1. In live mode, `DisclosurePolicy(reader over worker_signal_context, clock)` replaces the fake.
  2. `worker_delivery` backs `DeliveryStatePort`.
  3. Commit through `commit_nudge` with a deterministic `nudge_id`.
  4. Never surface `CoordinationOutcome` or `AgentAck` to the sender.
  5. Persist reflection text only (`vault.saveReflection`), never the candidate.
  6. Recipient preferences stay fail-closed until a consent table exists.
- **DS (Nimisha) next:** no-action cases may assert `not_opted_in`, `quiet_hours`, `cooldown` and `blocked_category` (availability-only). Ranking over private quiz extras runs on the device only (ACTIVITY_CONSENT.md §1.5).
- **Open gaps:**
  - Recipient support-preferences consent table (D021 #4).
  - Scheduled expiry sweep for views.
  - JWT `aud` check.
  - Rate limits.
  - Real-browser vault check (pagehide, on-disk IndexedDB).
  - C7 activity-sharing types and reducers (not permitted yet).
- **Details:** `docs/handoffs/cyber.md`, `docs/updates/cyber.md`, `src/privacy/{README,REVIEWS,ACTIVITY_CONSENT}.md`, `src/vault/DESIGN.md`.

### 2026-10-24T06:30Z | DS → CS, AI, Cyber | DS-R0–R2: nearby/event shortlist, discovery components, C8 consumer proposal
- **Branch/commit:** `role/ds-context` @ `b077a1e` (code) + `8812d7b` (docs), merged to main via PR #9 @ `fab86d6`. This handoff entry is a follow-up docs-only PR.
- **Status:** implemented and offline-verified on synthetic fixtures only, NOT live. The components are not composed into any real page, there is no C8 schema, query or guard, and nothing ran against SpacetimeDB or a provider.
- **Evidence (rerun on main @ `fab86d6`):**
  - `npm run check:all` exits 0: contracts 63/63, app 131 pass / 0 fail / 1 todo (a3 known gap: semantic `signalId` accepted by the offline fake).
  - `node src/evaluation/report.ts --write` → `src/evaluation/results/latest.md`. Nearby/event, 15 cases (6 positive / 9 no-action): `ds_nearby_v1` top-1 6/6, P@3 1.00, false matches 0/15, correct no-action 9/9. The most-tags baseline scores top-1 4/6, false matches 8/15 (16 people), no-action 3/9.
  - Activities (12 cases): top-1 6/6 vs 1/6 soonest-first. Support (30 cases): 29/30.
  - Labels come from one DS annotator who also designed the rankers, so the numbers are optimistic. Human 1–5 ratings have NOT been collected.
  - A temporary `/ds-preview` page rendered both components from fixtures under `next start` and was then removed. This is not evidence for the composed app.
- **Interfaces:**
  - `src/features/discovery/types.ts`: DS **consumer proposal** for C8 (`DiscoveryCandidate`, `DiscoveryViewer`, `PublishedEventIntent`, `DiscoveryMode`, `ReasonCode`, `DiscoveryShortlist`). These are not contract types; replace them with reviewed `@kinetic/contracts` C8 exports when those land.
  - Candidate card fields: opaque `ref`, `displayName` (≤60), `avatarMediaId|null` (no URLs), `tags` (allowlisted slugs, ≤10), `eventIntents [{eventId, intent: interested|going, expiresAt}]`, `publicationVersion`, `publicationExpiresAt`, `withdrawn`, `blocked` (either direction), `alreadyConnected`. Any extra field (coordinates, distance, areaKey, support or journal fields) rejects the card as `invalid_card`.
  - `rankNearby({viewer, candidates, mode, allowedTags, now})` (`src/evaluation/nearby.ts`):
    - Pure; returns ≤3 entries `{ref, reasons, sharedTags, sharedEventId, theirIntent}` and never reads display names.
    - Removes self, blocked, withdrawn, expired, already-connected and duplicate cards, plus rows past the 50-row cap (reported as `truncated`).
    - Scores shared tags, +2 for a shared current event intent, +1 when the event topic is a shared tag; ties break on the opaque ref.
    - No-shortlist reasons: `not_published`, `viewer_has_nothing_published`, `viewer_no_event_intent`, `empty_area`, `no_fit`.
  - `DiscoveryResults` / `EventResults` (`src/features/discovery/`): props-only components with honest empty states. They never show a percentage, distance or attendance claim and never send anything themselves.
  - `rankActivities` (`src/evaluation/rank.ts`): links go through contracts `safeCatalogueUrl`; `allowInPerson` (default false) enables local in-person events.
- **CS next:**
  1. On Discover, render `<DiscoveryResults shortlist candidates onInvite onBlock onEmptyAction invitedRefs synthetic />` with `shortlist = rankNearby(...)` over your authorized candidate page (≤50 rows, area/audience filtered server-side).
  2. For events, render `<EventResults result items sourceStatus allowedSourceHosts now utcOffsetMinutes onChoose />`.
  3. Wire `onInvite` / `onBlock` to guarded reducers only. Set `synthetic` while data is seeded.
  4. Ship the C8 candidate query returning exactly the projection above.
  5. Sanitize or flag instruction-like catalogue titles (`act-injection-text` still ranks 2nd in ac1/ac3).
  6. Decide how the rankers are packaged for worker import (root `package.json` is CS-owned). Apply the D027 Q2 copy edit.
- **AI (Adam) next:**
  1. The introduction workflow receives ≤3 shortlist entries; prompts may contain only reason codes and shared tag slugs.
  2. Zero entries means no model call.
  3. Keep passing `rank: rankAckOptions` for coordination options.
- **Cyber (Sumedh) next:**
  1. Confirm the `types.ts` projection is the full permitted field set for C8 publication.
  2. Confirm that block/withdraw/expiry/connected flags are computed authoritatively on the server. The ranker's checks are defensive only.
  3. Close a3: opaque `signalId` validation in the pure guards.
- **Team:** two independent raters fill `src/evaluation/results/ratings-template.md`.
- **Open gaps:**
  - No C8 schema, candidate query or guards.
  - No activity-interest consent category (C7 person-specific delivery stays blocked).
  - Rankers are not importable by the worker.
  - No live catalogue.
  - `LocalQuizExtras` has no runtime schema.
  - a3 is still open.
- **Run:** `npm run check:all`; `node --test "src/evaluation/__tests__/*.test.ts" "src/features/discovery/__tests__/*.test.ts"`; `node src/evaluation/report.ts --write`.
- **Details:** `docs/handoffs/ds.md`, `docs/updates/ds.md`, `src/evaluation/results/latest.md`, `src/features/discovery/types.ts`.
