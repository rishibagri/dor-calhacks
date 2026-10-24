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
| CS — you | role/cs-app PR #35: Core 3 **partial live smoke 26/26** (+`--sweep` 30/30 live marker proof) via `scripts/smoke-core3.ts`; D041 pause controls on #34 (pause/resume, owner list, paused never offered); quiz → unsaved preset drafts; unnamed/duplicate labels + fail-closed exclusions; strict candidate parse (DS i2 closed); `npm run bindings:check` + CI. Nudge delivery, browser UI NOT verified | Sumedh: narrow `my_nudges` row, sender-only receipt actions, reason code, pause interface answers (docs/team-messages/core3-audit.md). Adam: worker reconnect, nickname exclusions, paid Stage C. Nimisha: new label cases. AI+CS: r4m (no assessment ⇒ ask?) |
| DS — Nimisha | On main: DS-R0–R3 extension work and Core 1/2 eval (PR #32 @ 76a9592). New PR from role/ds-context: evaluator follows CS's DecisionLoop composition (pause → unnamed guard → assessment → decide); 55 labeled cases incl. core3-audit cases: 52/55, silence 22/22, missed 0/9, unsafe 0 (i2 closed by CS), forbidden 3 (r4m, nn1, nn2); Core 3 baselines (no-assessment loop: 8 excluded surfaced; preview-on-candidate: 41 unsafe) + blinded two-rater workflow (113 items); ratings NOT collected | Team: 2 raters (not DS) fill `src/evaluation/results/ratings/rater-{a,b}.md`. Adam: nickname exclusions (nn1/nn2); D042 with CS (r4m). Sumedh: narrow `my_nudges` (timing todo), a3. DS next: f4 quiz-space decision, score ratings, Core 4 |
| Cyber — Sumedh | role/cyber-privacy (on main 126f072): **Core 2 D041 durable recipient pause** implemented offline: `pause_recipient` / `resume_recipient` / `my_recipient_pauses`, enforced at approve, worker view, commit (same refusal as revocation) and `my_nudges`; revokes pre-pause approvals so nothing resurrects. Reviews: #30 ACK (no leak), D040 ACK-with-conditions. check:all + ai:check green (keys stripped); 16/16 mutations | CS: bindings + pause controls/copy. Adam: no worker change; add 4 integration pause cases. Nimisha: paired pause evals. Cyber next: Core 3 live two-account + denied-third run |
| AI — Adam | On main (#27): Droid SDK worker default, 25 s job budget, reflection dedupe, plan/intro extension paths. role/ai-voice (PR pending): **D040 private assessment**, i.e. Claude returns an owner-only `assessment` (intent + explicit name exclusions/preferences) that only narrows CS's decision loop (docs/features/PRIVATE_ASSESSMENT.md); doctor now requires FACTORY_API_KEY for the SDK default. Offline only | Cyber: durable pause per docs/features/RECIPIENT_PAUSE.md (D041). CS: review the DecisionLoop/journal wiring. DS: evaluate the assessment cases. Adam next: live Claude run on synthetic cases (needs key + go-ahead) |

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

### 2026-10-24T17:30Z | DS → CS, AI, Cyber | PR #25: D039/D038 extension maintenance + card report; DS moves to core-first
- **Branch/commit:** `role/ds-context`; PR #25 is open. The first commit is `e0b5988`; the follow-up merges main `71c3b6a` (README core-first, CS Events page #24) and keeps CS's Events page working. Earlier DS work on main: PR #13 (`d98cc04`) and PR #17 (`90d789a`).
- **Scope under the new README:** discovery and events are preserved extensions. This PR adds no discovery scope:
  - it removes an indirect disclosure (D039);
  - it aligns DS with the server's projections;
  - it keeps CS's `/events` working;
  - it adds a safety control (Report).
- **Status:** implemented and offline-verified, NOT live:
  - `/discover` runs DS nearby ranking, and `/events` runs DS `eligibleEvents` (CS PRs #22/#24);
  - the module is unpublished and the data is synthetic.
- **Evidence:**
  - `npm run check:all` exit 0: contracts 116, module 143, app 244 + 1 todo (a3).
  - `npm run ai:check` exit 0: agents 64, worker 21, integration 19.
  - `next build --webpack` OK (`/discover`, `/events`).
  - DS suite 149 pass / 0 fail / 1 todo.
  - CS `events-model.test.ts` passes 4/4. Before the fix, merging this PR into main failed it 3/1.
  - Mutations: 16 on the D039 code (15 caught, 1 redundant check removed), 2 on the report allowlist and 4 on the CS-shape compatibility; all caught.
- **Privacy fix (D039):**
  - `ShortlistEntry.theirIntent` and the "(they said: …)" line are removed.
  - Candidates carry only mutual `sharedEventIds` from `event_companions`.
  - `rankNearby` rejects cards that carry `eventIntents` or `theirIntent`.
- **Interfaces:**
  - `rankEventCompanions({viewer, viewerAreaKey, catalogue, myIntents, cards, companions, allowedTags, now})` reads the generated view rows and returns events with the viewer's own `viewerIntent` and ≤3 companions, plus `candidates` and `withheld`.
  - `eligibleEvents` / `parseCatalogueEvent`:
    - accept `catalogue_events` view rows AND CS's `toListing` shape (`status: 'scheduled'`, `endsAt` omitted, no title/url);
    - reject any other status and any unknown key;
    - return normalized view-shape copies;
    - enforce 48 h freshness and Cyber's area rule.
  - `forIntroductionProposals(entries)`: D038 `shared_interest`-only with ≤3 tags.
  - `DiscoveryResults` gains an optional `onReport(ref, reason)` with an allowlisted picker; nothing is sent before "Report and block".
- **DS next (core-first, README Core 1–4):**
  1. Core 1: define expected `no_action` / `needs_clarification` / `ready_for_preview` outcomes for support, avoid and uncertain recipient intent, plus the forbidden-disclosure labels, before any model evaluation.
  2. Core 2: paired fixtures (same general availability, different recipient intent; "not Alex tonight"; ambiguous timing; skipped question; changed answer; prompt injection; the private-party case), and a noninterference check (approved inputs fixed, private story varied ⇒ recipient-visible content and timing unchanged).
  3. Core 3: two teammate ratings; unsafe suggestions reported separately from missed ones; deterministic baseline.
  4. Core 4: partner/friend/family examples plus the private-party no-action case, with the real sample size.
  - No new discovery or event ranking work until the core passes live verification.
- **CS next:**
  1. Pass `onReport={(ref, reason) => void runAction(() => reportCard(shared, ref, reason))}` in `src/app/discover/page.tsx`.
  2. Optional: pass `catalogue_events` rows to `eligibleEvents` directly instead of `toListing`; both shapes are supported.
- **Cyber (Sumedh) next:**
  1. ACK that DS consumes `event_companions` only.
  2. Filter linked pairs from `discovery_cards` (`alreadyConnected` is half closed).
  3. Export an event-ID validator.
  4. a3.
  5. Co-define the Core 1 recipient-restriction labels DS will evaluate against.
- **AI (Adam) next:**
  1. Gate `same_event` introduction proposals with `forIntroductionProposals` (D038 refuses them).
  2. Share the private-assessment output vocabulary so DS can label Core 1 cases against it.
- **Open gaps:**
  - `alreadyConnected` is half closed.
  - Rankers are not worker-importable.
  - The module is unpublished.
  - No human ratings.
  - No Core 1 labels yet.
- **Details:** `docs/handoffs/ds.md`, `docs/updates/ds.md`.

### 2026-10-24T18:45Z | DS → CS, AI, Cyber | Core 1 labels + Core 2 paired decision-loop scenarios
- **Branch/commit:** `role/ds-context` on main `5df9fcd`; PR to main is open (not merged). Read the remote role branch until it merges.
- **Status:** implemented and offline-verified against CS's pure `decide()`, synthetic only, NOT live. No model assessment was evaluated because none exists yet.
- **Interfaces (DS-owned, evaluation only, no contract change):**
  - `src/evaluation/fixtures/decision-cases.json`: 24 cases (support/avoid/uncertain). Each has an expected `no_action` / `needs_clarification` / `ready_for_preview` (README design vocabulary) and forbidden-disclosure terms under six labels: `unapproved_recipient`, `private_activity`, `location`, `excuse`, `relationship_tension`, `timing_detail`. The labels were written from the README rules before any run and are never relabeled to match the code.
  - Pairs: general vs specific, explicit refusal, ambiguous timing, skipped question, changed answer, prompt injection, private party, no candidate; plus a 4-story noninterference set.
  - `src/evaluation/decision-loop.ts`: `replay`, `surfacesOf`, `leaksOf`, `scoreCase` (unsafe and missed reported separately) and `observable` (preview + nudge schedule). It imports CS's `decision-loop-model.ts` from evaluation code only, as PRIVATE_DECISION_LOOP.md invites; production code must not import it.
  - `report.ts` has a new Core 1/2 section in `results/latest.md`.
- **Evidence:**
  - Decision suite: 31 pass / 0 fail / 2 todo (known gaps).
  - `npm run check:all` exit 0: contracts 116, module 143, app 293 pass / 0 fail / 3 todo.
  - Report: 22/24 expected outcomes, missed 0, unsafe 2 (both known gaps), correct no-action 8/9.
  - Noninterference: 4 private stories give an identical outcome, preview, recipient copy and nudge schedule.
  - Fixed-copy scan: no story term in any question, note, no-action or template text.
  - Mutations on CS's model: 5/5 caught (ignored exclusion, skip fall-through, changed answer keeps choice, auto-pick fallback, leaky copy). The model was restored and is unchanged.
- **AI (Adam) next:**
  1. Implement the private assessment → `excludeForNow` seam, so a refusal written only in the entry ("not Alex tonight") excludes that person without a button tap. Case `r4` is a todo test until then; when it lands, remove its `knownGap` and set `assessment.exclude`.
  2. Map invalid, refused or timed-out assessment output to `no_action`. The assessment may exclude or veto; it may never set `chosen`.
  3. Run the 24 cases against the real assessment once it exists (Core 3).
- **CS (Rishi) next:**
  1. Parse the candidate with `SignalCandidateSchema` in `startLoop`/`decide` (a failed parse is treated as `null`), so a malformed candidate never reaches `ready_for_preview`. Case `i2` is a todo test; `previewDisclosure` already denies it downstream.
  2. Optional: export the model's helpers through a shared seam if the team wants evaluation code to avoid the direct import.
- **Cyber (Sumedh) next:**
  1. Review the six forbidden-disclosure labels against the recipient-restriction and pause semantics.
  2. Once the durable pause contract lands, DS adds the change-of-mind-during-generation case (not covered yet).
  3. a3.
- **DS next:** Core 3: two teammate ratings, unsafe and missed reported separately, compared with the deterministic baseline. Core 4: partner/friend/family examples plus the private-party no-action case, with the real sample size.
- **Open gaps:**
  - r4 (AI seam) and i2 (CS validation).
  - Single DS annotator; no teammate ratings.
  - No pause or change-of-mind case.
  - The module is unpublished.
- **Run:** `node --test src/evaluation/__tests__/decision-loop.test.ts`; `node src/evaluation/report.ts --write`.
- **Details:** `docs/handoffs/ds.md`, `docs/updates/ds.md`, `src/evaluation/results/latest.md`.

### 2026-10-24T20:00Z | DS → AI, CS, Cyber | Core 1/2 v2: decision-loop evaluation through D040 private assessment (PR #32 update)
- **Branch/commit:** `role/ds-context` with main `126f072` merged (`23a8eed`, no conflicts), pushed to the open PR #32 (not merged).
- **Status:** implemented and offline-verified, synthetic only, NOT live. AI's fixture outputs are hand-written, not recorded Claude responses, so this measures the loop given an assessment, not Claude's accuracy.
- **What changed (DS files only):**
  - `src/evaluation/fixtures/decision-cases.json` v2, 44 cases:
    - 19 new `a*` cases reference all 10 cases in `src/agents/fixtures/reflection.synthetic.json` by ID. Nothing is copied; DS overrides exist only for explicit variants.
    - New r4m: the same refusal, with a missing assessment.
    - The v1 assessment inputs moved to the D040 shape; the labels are unchanged.
  - `src/evaluation/decision-loop.ts`:
    - `initialLoopState` → owner taps → `decide(assessedRecipients(...))`;
    - `resolveCases`;
    - metrics reported separately: appropriate silence, missed suggestions, unsafe suggestions, excluded person surfaced, forbidden disclosures.
  - Tests cover every screen (each step prefix):
    - excluded people stay excluded;
    - no story term appears, and recipient copy exists only at a preview;
    - D040 never chooses a person;
    - all AI fixture cases are covered, with no duplicated data.
  - The `report.ts` section is updated.
- **Evidence:**
  - DS decision suite: 54 pass / 0 fail / 2 todo (r4m, i2).
  - Report: 42/44; appropriate silence 18/19; missed 0/8; unsafe suggestions 1 (i2); excluded surfaced 0; forbidden-disclosure findings 1 (r4m).
  - `npm run check:all` exit 0: contracts 117, module 150, app 328 pass / 0 fail / 3 todo (a3, r4m, i2).
  - `npm run ai:check` exit 0: agents 69, worker 42, integration 36.
  - AI assessment + CS loop tests: 21/21.
  - Mutations on `assessment.ts`: 3/4 caught by DS. "Invalid → offer everyone" is masked by `initialLoopState`; AI's own test catches it.
- **AI (Adam) next:**
  1. **r4m:** a reflection with a candidate but no `assessment` currently asks normally, so an explicit "not Alex" in the entry is not honored. With CS, decide whether a missing assessment alongside a candidate should fail closed (`suggestsNothing`) or keep asking. Today the owner is still the only one who can pick and approve.
  2. Run the 10 reflection cases through real Claude (Core 3, with approval), then rerun `node src/evaluation/report.ts` on the recorded outputs.
- **CS (Rishi) next:**
  1. **i2 (still open):** parse the candidate with `SignalCandidateSchema` in `startLoop`/`initialLoopState`; `previewDisclosure` already denies it downstream.
  2. Co-decide r4m with Adam.
- **Cyber (Sumedh) next:** review the six forbidden-disclosure labels against D041 (`RECIPIENT_PAUSE.md`). DS adds the change-of-mind-during-generation case once the pause lands.
- **r5 resolved (DS owner decision):** when the owner taps an assessment-excluded person, the loop ends with `no_action: no_recipient`.
  - This is preferred because the excluded person must not be contacted or substituted automatically, and re-asking would invite a second choice.
  - Verified against PRIVATE_ASSESSMENT.md §3, README "Deterministic exclusion", CS `decide()` and AI's assessment test.
  - The v1 label (`needs_clarification`, who, [p-sam]) is kept in the case's `labelHistory`. No other label changed.
- **DS next:** Core 3: two teammate ratings, compared with the deterministic baseline.
- **Run:** `node --test src/evaluation/__tests__/decision-loop.test.ts`; `node src/evaluation/report.ts --write`.
- **Details:** `docs/updates/ds.md`, `docs/handoffs/ds.md`, `src/evaluation/results/latest.md`.

### 2026-10-24T21:15Z | DS → Team, AI, CS, Cyber | Core 3: baseline comparison + two-rater workflow (decision loop)
- **Branch/commit:** `role/ds-context`; this goes into the open PR #32 once the owner approves the commit (not merged).
- **Status:** implemented and offline-verified, synthetic only, NOT live. **Teammate ratings have NOT been collected (0 of 2).**
- **Interfaces (DS-owned, evaluation only, no contract change; no AI, CS or Cyber file touched):**
  - `src/evaluation/decision-baselines.ts`: `DECISION_SYSTEMS` with three systems:
    - `d040_loop`: the current pipeline;
    - `loop_without_assessment`: CS's loop without the D040 assessment;
    - `preview_on_candidate`: DS's `matching.ts` `buildPreview` as a "support match is enough" strawman.
  - `scoreCase(file, case, system)` defaults to `d040Loop`; Core 1/2 scoring is unchanged.
  - `src/evaluation/ratings.ts` + `rate.ts`: blinded sheets, a hidden key holding a fixture hash, a strict parser, per-system aggregation, Cohen's κ, and each rater's agreement with the DS labels.
  - The generated blank sheets and `key.json` (85 items) are in `src/evaluation/results/ratings/`.
- **Evidence (same 44 cases and labels; metrics kept separate):**

  | System | Expected | Silence | Missed | Unsafe | Excluded surfaced | Forbidden (cases / terms) |
  |---|---|---|---|---|---|---|
  | `d040_loop` | 42/44 | 18/19 | 0/8 | 1 | 0 | 1 / 1 |
  | `loop_without_assessment` | 29/44 | 13/19 | 3/8* | 4 | 6 | 10 / 15 |
  | `preview_on_candidate` | 13/44 | 5/19 | 0/8 | 31 | 8 | 15 / 30 |

  *The 3 missed cases partly come from replaying D040's taps.
  - Ratings tests 13/13; rating-workflow mutations 5/5 caught.
  - `npm run check:all` exit 0; `npm run ai:check` exit 0.
- **Team next:**
  1. Two teammates who didn't write the labels each take one sheet (`rater-a.md` / `rater-b.md`, ~85 items, about 45–60 min). Rate independently, without discussing, and don't open `key.json`, the fixtures or the report first.
  2. Return the filled sheets to the same paths.
- **DS next:** run `node src/evaluation/rate.ts --score` and `node src/evaluation/report.ts --write`, then report usefulness/safety per system, inter-rater κ and rater vs DS-label agreement. After that, Core 4 examples and the sample size.
- **Unchanged open items:**
  - r4m: todo, pending D042 (Adam + CS).
  - i2: todo, pending CS's candidate validation.
  - The AI fixture outputs are hand-written (no live Claude run).
- **Run:** `node --test src/evaluation/__tests__/ratings.test.ts`; `node src/evaluation/rate.ts --sheets|--score`; `node src/evaluation/report.ts --write`.

### 2026-10-24T23:30Z | Cyber → CS, AI, DS | Core 2: D041 durable recipient pause (implemented offline) + #30/D040 reviews
- **Interfaces:** `pause_recipient({pair_id, expires_at, expected_version})`, `resume_recipient({pair_id, expected_version})`, owner-only view `my_recipient_pauses {pair_id, version, expires_at, active, created_at}`.
  - `approve_signal` refuses with `unauthorized: recipient_paused`.
  - Paused signals are absent from `worker_signal_context`.
  - `commit_nudge` refuses with `stale: revoked`; there is no new worker field.
- **Guarantees:** owner-only, reason-free, 15 min to 30 days; pre-pause approvals are revoked, so nothing resurrects; silent to the counterpart; fail closed; expiry via the sweep.
- **Reviews:** #30 ACK (no leak); D040 ACK with conditions (`src/privacy/REVIEWS.md`).
- **Next:**
  - CS: bindings and controls.
  - Adam: integration cases only.
  - Nimisha: paired evals.
  - Details: `docs/handoffs/cyber.md`, `docs/features/RECIPIENT_PAUSE.md`.

### 2026-10-25T00:30Z | DS → Team, AI, CS, Cyber | Core 1–3: evaluation on CS's current loop + core3-audit cases + baselines/ratings (new PR)
- **Branch/commit:** `role/ds-context` with main `e5796db` merged; new PR (not merged). PR #32 merged at `76a9592`; the Core 3 commit `342a800` was not in it and is included here.
- **Status:** implemented and offline-verified, synthetic only, NOT live. **Teammate ratings have NOT been collected.**
- **Interfaces (DS-owned, evaluation only, no AI, CS, Cyber or contract file changed):**
  - The evaluator mirrors CS's `DecisionLoop`: recipients → `withoutPaused` (D041) → `applyUnnamedExclusionGuard` → `assessedRecipients` → `decide`.
  - Cases may carry the owner's `pauses` rows, and people may be `unnamed`.
  - Core 3 adds `decision-baselines.ts`, plus `ratings.ts` / `rate.ts` (blinded two-rater workflow with a hidden key).
- **core3-audit.md DS items:**
  1. Unnamed, duplicate-name and pause cases added (u1–u3, d1–d2, pz1–pz4), all labeled before the run, all passing.
  2. Nickname cases in both directions (nn1, nn2), labeled before the run. They fail open as the audit said and stay todo with AI as owner.
  3. Quiz "space": support case f4 still assumes the old global promise. Flagged for the DS owner's decision; not relabeled.
  4. Timing:
     - Recipient copy does not depend on approval time (passes).
     - The nudge row encoding approval time is a todo pending Cyber's narrow `my_nudges`.
     - Recipient delivery state in sender receipts is outside the DS offline loop and covered by Cyber's `my_receipts` fix.
  5. No DS assertion on the wrong-`payloadRevision` reason code until Sumedh confirms.
- **Evidence:**
  - 55 cases: 52/55; appropriate silence 22/22; missed 0/9; unsafe suggestions 0; excluded surfaced 0; forbidden-disclosure findings 3 (r4m, nn1, nn2).
  - Baselines: `loop_without_assessment` 34/55, unsafe 3, excluded 8, forbidden 14 / 21; `preview_on_candidate` 14/55, unsafe 41, excluded 12, forbidden 21 / 42.
  - Pause noninterference: a paused third person changes nothing about the chosen person's preview.
  - `npm run check:all` exit 0: contracts 124, module 175, app 370 pass / 0 fail / 5 todo.
  - `npm run ai:check` exit 0: agents 69, worker 42, integration 36.
- **AI (Adam) next:**
  1. Close the nickname exclusions (nn1/nn2): core3-audit option (a) `unmatchedExclusions` → CS asks "Who did you mean?", or (b) a prefix/diminutive match is ambiguous and is left out.
  2. D042 with CS (r4m).
- **Cyber (Sumedh) next:**
  1. Narrow the `my_nudges` row; the timing todo flips when it lands.
  2. Confirm the reason code for a wrong revision.
  3. a3.
- **Team next:** two teammates who didn't write the labels each fill one sheet (113 items, roughly 60–75 min), independently, without opening `key.json`, the fixtures or the report first.
- **DS next:** decide f4; score the ratings (`node src/evaluation/rate.ts --score`); Core 4 examples and the sample size.
- **Run:** `node --test "src/evaluation/__tests__/*.test.ts"`; `node src/evaluation/rate.ts --sheets|--score`; `node src/evaluation/report.ts --write`.

