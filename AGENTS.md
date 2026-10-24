# Required agent entry point
Read this file before working, including after resuming. Human owners and their coding agents follow the same contracts.

## Read order
README.md → PRD.md → PROJECT_KNOWLEDGE.md → contracts/README.md → docs/PLAN.md → docs/TECH_STACK.md → contracts/specs/*.md → your docs/roles/<role>.md and docs/handoffs/<role>.md → all role update logs.

## Contract-first development
C7 includes executable catalogue-input/link guards but shared activity types remain pending; C8 discovery publication/area/event-intent is proposed in contracts/specs/DISCOVERY.md. New scope never silently broadens C3 or D028.

C1 local profile/reflection; C2 presets/recipient assignment; C3 approved disclosure; C4 agent ACK/coordination; C5 nudge/receipt; C6 policy and offline test boundary. Producer/consumer ownership is in contracts/README.md. Import only @dor/contracts across workstream boundaries. Do not reach into another owner's internals or duplicate wire types. Build against explicit fixtures/fakes until real adapters exist; never import fakes into production mode.

## Setup and evidence
User preference: keep checks minimal and targeted to the changed behavior. Do not rerun broad suites for docs/config-only changes; use focused setup checks. Reserve full integration checks for integration or release changes. Never run paid-provider tests merely to verify configuration.

Run `npm ci` and `npm run check` at the repository root. These verify offline contracts only. Regenerate schemas with `npm run contracts:schema` after shape changes and update fixtures in the same PR. Never claim the application runs from these commands. Record planned, implemented, deployed and live-verified status separately in PROJECT_KNOWLEDGE.md.

## Shared contract visibility
All architecture, API, agent protocol, privacy, acceptance, and data contracts are shared on `main` and available to every teammate and agent. `main` is authoritative; do not maintain branch-specific private contracts. Merge shared contract updates from `main` into each role branch before dependent work. Separate video/presentation planning lives in docs/DEMO.md and is not required engineering-contract reading.

## Selected stack
dor uses Next.js/React/TypeScript, Tailwind/shadcn, SpacetimeDB reducers/private tables/caller-filtered views, Claude, Factory Droid, Cartesia, TypeScript/Zod, and IndexedDB/Web Crypto. Read docs/TECH_STACK.md before choosing dependencies. Never reintroduce server-stored journals or assume a quiz grants disclosure consent.

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
| CS — you | role/cs-app (PR #22, offline only): CS-R1 done in code (vault/voice/share review/revoke/recipient consent, bindings); CS-R2 Discover + area-indexed paged `discovery_cards` + `set_discovery_page`; not published or live-verified | CS-R3: event pages on D039 + one Apify catalogue. Cyber: review discovery_cards index/cursor/connected filter. DS: card `onReport` → `reportCard`. Adam: introduction proposal job |
| DS — Nimisha | On main: DS-R0–R2 (PR #9), strict `discovery_cards` adapter (PR #13), first DS-R3 cut (PR #17). DS nearby ranking + `DiscoveryResults` are composed in CS's `/discover` (PR #22; offline/synthetic). On `role/ds-context` (uncommitted, awaiting owner review): D039 fix (no other person's interested/going in output or UI), event companions only from `event_companions`, 48 h freshness and Cyber's area rule, D038 `forIntroductionProposals` gate, card-level `onReport` | CS: pass `reportCard` to `onReport`; CS-R3 event mappers → `rankEventCompanions`. Sumedh: ACK, filter linked pairs (`alreadyConnected` half closed), event-ID validator export, a3. Adam: gate `same_event` proposals (D038 refuses them). Team: ratings |
| Cyber — Sumedh | role/cyber-privacy (on main 2b8e59b): CYBER-R3 guarded catalogue ingestion, C8 event intents (mutual-only overlap), C7 activity approvals (preset-only, off by default), D034 plan finalization with current-source rechecks, `EventPrivacyControls` + exact preview copy (D039). R2 merged (#18). Offline only: contracts 116, module 137, app 193, ai 104; flag off, not published | CS: ACK D039, bindings, ingestion → `upsert_catalogue_event`, preview copy, preset toggle. Adam: `commit_plan_proposal` from `worker_plan_candidates`. Nimisha: `event_companions`. Cyber next: CYBER-R4 adversarial suite |
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
  - `@dor/contracts/policy` (no runtime dependencies; safe inside reducers) exports:
    - `guardApproval`, `guardSignalUse`, `guardSignalStanding`, `guardNudgeCommit`
    - `payloadRevision`, `policyErrorCode`
    - constants `SIGNAL_LIFETIME_MS` and `DISCLOSURE_CONSENT_VERSION`
  - `DisclosurePolicy` (`@dor/contracts`) is the real `DisclosurePolicyPort` for routes and the worker.
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
  - The CLI bundler's resolution of `@dor/contracts/policy` is untested.
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
  2. Swap `placeholderVault` for `new LocalVault({ store: new IndexedDbVaultStore(indexedDB, 'dor-vault:' + sha256(userId)) })`. Subscribe with `useSyncExternalStore(vault.subscribe, vault.getVersion)`. Add create / unlock / show-recovery-code-once / recover screens.
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
  - `src/features/discovery/types.ts`: DS **consumer proposal** for C8 (`DiscoveryCandidate`, `DiscoveryViewer`, `PublishedEventIntent`, `DiscoveryMode`, `ReasonCode`, `DiscoveryShortlist`). These are not contract types; replace them with reviewed `@dor/contracts` C8 exports when those land.
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

### 2026-10-24T07:30Z | Cyber → CS, AI, DS | CYBER-R0/R1: recipient consent, JWT aud, expiry sweep, C8 guards, privacy controls
- **Branch/commit:** `role/cyber-privacy` @ `0021c16` (boundary code) + `9b82854` (privacy component), on main `fab86d6`. PR #10 to main is open; it isn't merged yet.
- **Status:** implemented and offline-verified, NOT live. The module is unpublished, and harness results do not prove deployed isolation, real JWT mapping or the real scheduler.
- **Evidence:**
  - `check:all` exit 0: contracts 84, module 84, app 141 + 1 pre-existing DS todo.
  - `ai:check` exit 0: agents 45, worker 10.
  - `next build` ok; audit 0.
  - 19 of 20 mutations caught (list in `docs/updates/cyber.md`).
- **Breaking interface:** `commit_nudge` now requires `recipient_consent_id` and `recipient_consent_version`. Take them from `AgentAck.recipientConsentId/Version`.
- **CS next:**
  1. ACK D035 and the file claims.
  2. Set a fixed `aud` in the Clerk JWT template; after publish run `set_auth_issuer` and `set_auth_audience`.
  3. Compose `<VaultControls vault={vault} />` (`src/features/privacy/README.md`).
  4. Build the recipient preference settings UI.
  5. Regenerate bindings.
- **AI (Adam) next:**
  1. `worker_support_preferences` backs `RecipientPreferencesPort`.
  2. Bind consent in `commit_nudge`.
  3. Switch `DiscoveryTagSchema` to hyphenated slugs.
- **DS (Nimisha) next:** rank only `discovery_cards` rows; keep the C8 rejection cases in `src/privacy/REVIEWS.md`.
- **Open gaps:**
  - Views can't check `aud`.
  - View expiry is bounded by the 60 s sweep.
  - No rate limits yet.
  - Discovery is off until the C8 ACKs.
  - Introductions, report and limits are CYBER-R2.

### 2026-10-24T08:30Z | Cyber → AI, CS | Merged main (AI PR #11); worker wired to recipient consent
- **What changed:**
  - Resolved the `docs/DECISIONS.md` conflict: main's D033/D034 are kept verbatim and D035 is appended after them.
  - With the user's approval, edited Adam's worker adapter so the worker reads `worker_support_preferences` and passes `recipient_consent_id/version` from the compatible `AgentAck` into `commit_nudge`.
  - The integration tests now use real consent recorded through `set_support_preferences`.
- **Compatibility:** `supportPreferences()` on `WorkerStateSource` is optional (missing means no consent, fail closed). The `spacetimeWorkerPorts` override parameter and `UnavailableRecipientPreferences` are kept.
- **Evidence:**
  - `check:all` exit 0: contracts 95, module 84, app 147.
  - `ai:check` exit 0: agents 64, worker 21, integration 17.
  - Integration tests type-check with 0 errors.
  - `next build` ok; audit 0.
- **Adam:** review `worker/src/spacetime/adapters.ts`. **CS:** generated bindings must include the new view and the new `commit_nudge` args.

### 2026-10-24T09:30Z | Cyber → CS, AI, DS | Product renamed to dor (D037)
- **What changed:** the product name is **dor** (lowercase), replacing Kinetic/Closer. Packages `@kinetic/*` → `@dor/*`, env vars `KINETIC_*` → `DOR_*`, module/audience defaults `dor` / `dor-spacetimedb`, vault labels `dor-vault`, payload domain `dor-payload-v1`. D001 and CS's D036 (capitalised "Dor", copy only) are kept as history; D037 completes the rename in lowercase.
- **Evidence:** `check:all` and `ai:check` exit 0; `next build` ok; audit 0.
- **Everyone next:** merge main, `npm install`, replace any `@kinetic/` imports or `KINETIC_` env names on your branch (`git grep -l '@kinetic/\|KINETIC_'`), and update local `.env` files.

### 2026-10-24T16:30Z | Cyber → CS, AI, DS | CYBER-R2: introductions, report, limits, proposal commit guard (D038)
- **Status:** implemented and offline-verified, NOT live; discovery flag stays off; uncommitted on `role/cyber-privacy` (on main `030ead2`) until the owner commits.
- **Interfaces:**
  - Reducers: `send_introduction_request`, `respond_introduction_request`, `cancel_introduction_request`, `block_introduction_participant`, `report_discovery_user`, `dismiss_introduction_proposal`, worker-only `commit_introduction_proposal`.
  - Views: `my_introductions`, `my_introduction_proposals`.
  - Guards in `@dor/contracts/policy`. Component: `src/features/privacy/introduction-controls.tsx`. Matrix: `src/privacy/DISCOVERY_ENFORCEMENT.md`.
- **Evidence:** `check:all` and `ai:check` exit 0; 20/20 mutations caught.
- **Next:**
  - CS: regenerate bindings and compose the controls.
  - Adam: commit proposals through the guarded reducer.
  - Nimisha: D038 rejection cases as no-action evals.

### 2026-10-24T18:30Z | Cyber → CS, AI, DS | CYBER-R3: events, intents, C7 approvals, plan finalization (D039)
- **Status:** implemented and offline-verified, NOT live; discovery flag stays off; no live Apify source.
- **Interfaces:**
  - Reducers: `upsert_catalogue_event` (ingester only), `publish_event_intent`, `revoke_event_intent`, `approve_activity_interest`, `revoke_activity_interest`, `respond_plan`, `cancel_plan`, worker-only `commit_plan_proposal` / `revise_plan_proposal`.
  - Views: `catalogue_events`, `my_event_intents`, `event_companions`, `my_activity_approvals`, `my_plans`, worker-only `worker_plan_candidates`.
  - AI's D034 `applyPlanAction` is adopted unchanged as the finalization guard.
  - Copy and controls: `src/features/privacy/event-*`. Matrix: `src/privacy/DISCOVERY_ENFORCEMENT.md` (events section).
- **Evidence:** `check:all` and `ai:check` exit 0; 23/23 mutations caught.
- **Next:**
  - CS: regenerate bindings and wire ingestion.
  - Adam: commit plans from the worker view.
  - Nimisha: companions from `event_companions` only.

### 2026-10-24T17:15Z | DS → CS, AI, Cyber | D039/D038 compatibility + card report (PR #22 follow-up)
- **Branch/commit:** `role/ds-context` on main `6093b2a` (after CS PR #22), uncommitted and awaiting owner review. Earlier DS work on main: PR #13 (`d98cc04`, strict adapter) and PR #17 (`90d789a`, first DS-R3 cut, whose event logic this replaces).
- **Status:** implemented and offline-verified, NOT live:
  - DS nearby ranking and `DiscoveryResults` run inside CS's `/discover` (PR #22), but the module is unpublished and cards are labelled synthetic;
  - DS event companions are not composed (no event page yet).
- **Evidence:**
  - `npm run check:all` exit 0: contracts 116, module 143, app 228 + 1 todo (a3).
  - `npm run ai:check` exit 0: agents 64, worker 21, integration 19.
  - `next build --webpack` OK, with `/discover` prerendered.
  - DS suite 147 pass / 0 fail / 1 todo; `tsc --noEmit` clean.
  - Mutations: 16 on the D039 code (15 caught, 1 redundant check removed) and 2 on the report allowlist (both caught).
  - Eval metrics are unchanged.
- **Privacy fix (D039):**
  - `ShortlistEntry.theirIntent` and the "(they said: planning to go)" card line are removed.
  - `DiscoveryCandidate.eventIntents` is replaced by `sharedEventIds`, taken from `event_companions` only.
  - `rankNearby` rejects cards that carry `eventIntents` or `theirIntent`.
- **Interfaces:**
  - `rankEventCompanions({viewer, viewerAreaKey, catalogue, myIntents, cards, companions, allowedTags, now})` (`src/evaluation/events.ts`) reads the 4 view rows (the generated bindings' camelCase field names). It returns events with the viewer's own `viewerIntent` and ≤3 companions, plus `candidates` and `withheld` (`invalid_companion` / `not_mutual_here` / `card_not_visible`).
  - `eligibleEvents`: 48 h `CATALOGUE_MAX_SOURCE_AGE_MS`, Cyber's area rule, strict view keys; duplicate IDs withhold every copy.
  - `forIntroductionProposals(entries)` (`src/features/discovery/adapters.ts`): D038 `shared_interest`-only with ≤3 tags.
  - `DiscoveryResults` gains an optional `onReport(ref, reason: DiscoveryReportReason)`: an allowlisted picker with the D038 notice; nothing is sent before "Report and block".
- **PR #22 asks answered:** tag allowlist confirmed (identical to the DS fixtures); `onReport` delivered.
- **CS next:**
  1. Pass `onReport={(ref, reason) => void runAction(() => reportCard(shared, ref, reason))}` in `src/app/discover/page.tsx`.
  2. CS-R3: map `catalogue_events` / `my_event_intents` / `event_companions`, then call `rankEventCompanions` (`viewerAreaKey` only while `areaActive`) and render companions with `<DiscoveryResults>` in event mode.
  3. Decide the ranker import path for the worker.
- **Cyber (Sumedh) next:**
  1. ACK the consumption above.
  2. Filter linked pairs out of `discovery_cards`; accepted introductions are already hidden (`4844ae6`).
  3. Export an event-ID validator.
  4. a3.
- **AI (Adam) next:**
  1. `introductions/coordinator.ts:116` emits `same_event` proposals that D038's commit guard refuses; gate with `forIntroductionProposals`.
  2. Take `publicationVersion` from `result.candidates`.
- **Open gaps:**
  - `alreadyConnected` is half closed (linked pairs are still shown).
  - No event page or event mappers.
  - Rankers are not worker-importable.
  - No regional feed.
  - The module is unpublished.
  - D038/D039 cases are not in the metrics report yet.
  - No human ratings.
- **Details:** `docs/handoffs/ds.md` (integrated-vs-synthetic table), `docs/updates/ds.md`, `src/evaluation/README.md`.
