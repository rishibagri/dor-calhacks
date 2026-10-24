# dor — current project knowledge

## Reset baseline and priority
Inspected main **d7285eb** includes Cyber's real vault/F5/F7 work plus AI PR #7 and DS PR #8. The user requested a README/phase reset, not a code reset. Old P-phase assignments are superseded by README/docs/roles R0–R6; historical logs/handoffs retain their original commit-specific evidence. No teammate branch is reset.

Product: AI helping people connect with people. Three experiences: existing partner/friend/family relationships; nearby opted-in public profiles; same-local-event connections. User confirmed **one-time approximate location** and **public opt-in profiles visible before invitation acceptance**. Quiz remains 6–8 questions/skippable; all four personalization dimensions; explicit sharing confirmation. Discovery publication is separate from pair presets. Journaling is optional for finding people/events.

## Current implementation ledger

| Area | Implemented on inspected main | Still required |
|---|---|---|
| App / identity / bindings | Next.js pages incl. Discover; per-account vault, voice reflection, share review → `approve_signal`, approved-signal revoke, recipient opt-in/consent UI, unreadable-row states; bindings regenerated from the current module (spacetime 2.13.0) for client and worker (#16, #19, #21, #22) | Publish module, configured worker/account identities, Clerk audience, deployed browser verification |
| Vault | `LocalVault`, Web Crypto, IndexedDB adapter, recovery/lock lifecycle, profile/extras and reflection-text storage; per-account instance and VaultControls composed (#16) | Real-browser persistence, pagehide and account-switch checks |
| Existing connection guards | One shared policy; guarded approval, opt-in/delivery, worker-only commit, caller-filtered views | Authoritative recipient support-preference storage + commit binding; expiry/snooze visibility; JWT audience; scoped rate limits |
| AI / voice | Claude/Cartesia adapters, authenticated routes, browser voice helpers; real-policy worker factory and replay ledger | Journal UI and database adapters, browser/provider live runs, deployed worker |
| Droid efficiency | Haiku default and reused private working directory; Adam recorded isolated live comparisons | Concurrent execution/total deadlines; independent whole-pipeline cost and quality measurements |
| DS | Quiz fixtures, 30 support cases; ACK rank hook; 12 activity cases, ranker and baseline results | Reviewed canonical C7/C8 exports, nearby/event cases, independent human usefulness ratings |
| Apify | Executable input/link guards in `contracts/src/catalogue.ts` | Actual selected source/Actor, ingestion/cache, catalogue schema and live retrieval |
| Nearby / event introductions | CS-R2 composed (#22, offline): Discover page with exact-preview profile publish, one-time on-device area coarsening (coordinates discarded), DS shortlist over an area-indexed, cursor-paged `discovery_cards` that hides accepted introductions, AI suggestions with fixed copy, Cyber `IntroductionControls`, Privacy discovery status, synthetic-data label (`NEXT_PUBLIC_DISCOVERY_SYNTHETIC`). Cyber layer, offline only, behind the off-by-default flag (role/cyber-privacy, D035/D038): proposed C8 publication/area/block guards; introduction request/accept/cancel with no decline oracle, report, per-caller limits, worker-guarded AI proposal commit; `IntroductionControls` component; D039 guarded catalogue ingestion, event intents with mutual-only overlap, C7 activity approvals, D034 plan finalization with current-source rechecks, `EventPrivacyControls`. DS shortlist/event eligibility; AI introduction/plan coordinators | Owner ACKs; module allowlists via `node scripts/discovery-config.ts`; card-level report UI (DS component); AI proposal job; CS-R3 event pages; real Apify ingestion calling `upsert_catalogue_event`, deployed two-account verification |
| Deployment | Offline code/test evidence and attributed isolated Droid evidence | Full app + database + providers together; no end-to-end live claim yet |

No full deployed end-to-end evidence is established. Do not confuse LocalVault's adapter status or a live-worker factory name with an integrated/deployed application. The existing app composition still uses placeholders. The C8 discovery contract is a proposal; no runtime schema was changed by this reset.

## Latest reviews to preserve
D026 reconciles preview and approval through one policy. D016–D020 are Cyber-ACKed; D021 is ACKed with conditions in src/privacy/REVIEWS.md: persist reflection text only, keep candidate in memory; recipient-preference consent storage and commit binding are now implemented on role/cyber-privacy (D035; offline harness only, not published); outcome codes/ACKs are never sender-visible. D028 executable Apify guards reject user context and location. D027 DS rank/mapping decisions remain; no blanket consumer ACK is implied by this planning update.

## Evidence and limitations
Team-reported isolated Droid comparison (docs/handoffs/ai.md): 12 Haiku runs used 289 Factory credits; 12 reused-directory Opus runs used 9,448. These are recorded runs with fake policy/preferences and no full database path; not a forecast of total application cost. Claude, Cartesia, browser microphone and deployed state need live verification.

DS report: 30 support cases (one known semantic signal-ID TODO), 12 synthetic activity cases; author-labeled relevance, not independent user usefulness. Cyber's upstream signal ID generation mitigates the TODO in the module harness; do not call it proven closed in every boundary. New nearby/event evaluations are still to be built.

Current reset verification is recorded below with exact commands/results. No paid providers or Actor jobs are launched for this documentation review.

## Next owned work
CS: app composition, per-account vault wiring, real identity/bindings, one configured local catalogue and discovery state. Nimisha: C8 candidate/quality logic plus discovery result component. Adam: voice feature plus authoritative worker adapters and call efficiency. Sumedh: preference consent/expiry/audience/discovery guards plus privacy controls. Detailed responsibilities/acceptance/handoffs are in docs/roles and docs/PLAN.

## Operational boundaries
No raw journals/audio/quiz extras/exact coordinates in shared state or agent logs. No location/profile inputs to Apify; use a developer-configured public regional feed under D028 review. C7 new activity and C8 publication consent must be reviewed before sharing. No automatic contact/booking/payment, invented neighbors, copied attendance lists or inferred habitual locations. Existing pair consent cannot authorize strangers. Preserve R5 live verification and R6 recovery within the original deadline.

The detailed personal assessment requested by the user is kept local and delivered in chat, not committed to GitHub. This file holds implementation status only.

## Reset verification — main d7285eb plus documentation changes
Fresh locked install completed. `npm run check:all` exited 0: contracts 63, in-process module 52, typecheck clean, app/vault/evaluation 102 passed + 1 known TODO (semantic signal ID). `npm run ai:check` exited 0: agents 45, worker 10. Default app build was blocked by environment restrictions (font download, then Turbopack port/process operation); alternate `npm run build:app -- --webpack` passed. This is compile/offline evidence, not deployed/provider/browser evidence. Local link/phase/decision-ID and `git diff --check` validation passed. No runtime schema or implementation code changed by this reset; no paid provider/Actor call ran.

## CS integration follow-up — codex/cs-app-integration (2026-10-24)

Supersedes the older placeholder statements for this branch only: account-specific LocalVault initialization now uses hashed Clerk account namespaces, cancellation/pagehide locking and reactive lifecycle state. Journal and Privacy compose the existing VoiceReflection and VaultControls; journal can save, list, open and delete local entries/reflections. Account change remounts private UI; locking unmounts the editor. Generated client/worker SpacetimeDB bindings and Node ESM build fixes from the Desktop working copy are included. No shared contract shapes changed.

Reconciled with main 6093b2a: recipient preview/approval, support-preference settings, Discover composition and authoritative event/plan guards have since landed and are preserved. Remaining integration/live gates include event-page/catalogue work, deployed worker/auth configuration and real-browser/provider E2E verification. The core-first roadmap is proposed separately in PR #26. Claude is not configured locally; Cartesia configuration is not proof of live operation. No deployment or paid provider test was performed. Relationship safety requirements and their limited regression evidence are in docs/features/RELATIONSHIP_SAFETY.md.

## AI follow-up — role/ai-voice (2026-10-24)

Offline-verified unless stated otherwise.
- **Factory sponsor path:** the worker's default Droid transport is the SDK (`@factory/droid-sdk` sessions, `worker/src/droid-sdk.ts`). `droid exec` is only the explicit `DOR_DROID_TRANSPORT=cli` fallback. Isolated live SDK run with synthetic stand-ins (not deployed): 4/4 agent-decided.
- **Core coordination:** a 25 s aggregate job budget covers slot wait and rounds. `/api/reflections` coalesces duplicate in-flight requests and logs metadata-only usage.
- **Extension paths (not core gates):** plans over `worker_plan_candidates` → `commit_plan_proposal`; the introduction commit over `commit_introduction_proposal` is not wired, because there is no worker-readable candidate source yet.
- **Private assessment (D040), role/ai-voice:** Claude returns an owner-only assessment that only narrows CS's decision loop (`docs/features/PRIVATE_ASSESSMENT.md`). Offline-verified; live Claude evidence pending.
- **Not built yet:** the durable recipient pause. Cyber owns it (D041); requirements are in `docs/features/RECIPIENT_PAUSE.md`.
- **Token safety:** offline checks never load `.env.local`; paid runs are explicit.

## AI backend status — role/ai-voice (2026-10-24 ~20:10Z)
- **Worker:**
  - SDK auto-reconnect; fails closed while disconnected; event-driven sweeps with a 15 s fallback.
  - Exits for a supervisor restart after a 2 min outage; `/healthz` returns 503 while down.
  - D041 pause honored with no worker change (5 integration cases); mid-job disconnects never lose or duplicate a nudge (2 cases).
  - Offline-verified.
- **Assessment:** nickname-tolerant exclusions; `unmatchedExclusions` for CS. D042 (r4m) resolved: the contract requires an assessment with any candidate, and the app fails closed.
- **Live (isolated, synthetic):**
  - Claude reflection + assessment, 10 cases on Opus 5.5: hard safety checks 10/10, ~$0.01/call.
  - Cartesia token/TTS/STT pass.
  - Not yet: browser voice (Stage B) and nudge delivery through the worker (Stage C).
