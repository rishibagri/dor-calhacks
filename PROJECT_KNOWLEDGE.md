# dor — current project knowledge

## Reset baseline and priority
Latest fetched main for this task: **cb73d30** (2026-10-24). The earlier d7285eb reset baseline and README snapshots are historical. Detailed product/phase instructions now live in INSTRUCTIONS.md; README.md is a concise entry point. No teammate branch was reset.

Product: AI helping people connect with people. Three experiences: existing partner/friend/family relationships; nearby opted-in public profiles; same-local-event connections. User confirmed **one-time approximate location** and **public opt-in profiles visible before invitation acceptance**. Quiz remains 6–8 questions/skippable; all four personalization dimensions; explicit sharing confirmation. Discovery publication is separate from pair presets. Journaling is optional for finding people/events.

## Current implementation ledger

| Area | Implemented on inspected main | Still required |
|---|---|---|
| App / identity / bindings | Next.js pages incl. Discover; per-account vault, voice reflection, share review → `approve_signal`, approved-signal revoke, recipient opt-in/consent UI, unreadable-row states; bindings regenerated from the current module (spacetime 2.13.0) for client and worker (#16, #19, #21, #22) | Publish module, configured worker/account identities, Clerk audience, deployed browser verification |
| Vault | `LocalVault`, Web Crypto, IndexedDB adapter, recovery/lock lifecycle, profile/extras and reflection-text storage; per-account instance and VaultControls composed (#16) | Real-browser persistence, pagehide and account-switch checks |
| Existing connection guards | Shared policy; guarded approval, recipient opt-in/preferences, worker-only commit, caller-filtered views, D041 pause, D044 standing-consent reducers and owner view in source | Frontend D044 controls/automatic approval are in this PR and offline-only until merged/live checked; Maincloud deployment is reported by the team but not verified by this PR |
| AI / voice | Claude/Cartesia adapters, authenticated routes, browser voice helpers; real-policy worker factory and replay ledger | Journal UI and database adapters, browser/provider live runs, deployed worker |
| Droid efficiency | Haiku default and reused private working directory; Adam recorded isolated live comparisons | Concurrent execution/total deadlines; independent whole-pipeline cost and quality measurements |
| DS | Quiz fixtures, 30 support cases; 12 activity cases; nearby/event ranker + baseline; Core 1–4 decision-loop evaluation (55/55); D044 consumer check; D045 Berkeley newcomer personas (9 discovery cases 9/9) and paired new-vs-reconnect evaluation (7/7) over Cyber's real guards + CS's real normalizer, source replay ready for an Actor dataset; all synthetic and offline | Independent human ratings (0/2), replay on a real approved Actor dataset, deployed replay, D047 fixture migration (awaits ACKs) |
| Apify | D028 query/link guards; D045 server-only Luma/Meetup adapter, bounded normalization/cache, fixture tests and `scripts/ingest-catalogue.ts --fetch [--commit]` | Live Actor retrieval and commit remain unverified; source terms/maintenance, pinned Actor build, Cyber D028 review and a capped run are pending. `--fetch` spends credits; no paid call was made in this task |
| Nearby / event introductions | CS-R2 composed (#22, offline): Discover page with exact-preview profile publish, one-time on-device area coarsening (coordinates discarded), DS shortlist over an area-indexed, cursor-paged `discovery_cards` that hides accepted introductions, AI suggestions with fixed copy, Cyber `IntroductionControls`, Privacy discovery status, synthetic-data label (`NEXT_PUBLIC_DISCOVERY_SYNTHETIC`). Cyber layer, offline only, behind the off-by-default flag (role/cyber-privacy, D035/D038): proposed C8 publication/area/block guards; introduction request/accept/cancel with no decline oracle, report, per-caller limits, worker-guarded AI proposal commit; `IntroductionControls` component; D039 guarded catalogue ingestion, event intents with mutual-only overlap, C7 activity approvals, D034 plan finalization with current-source rechecks, `EventPrivacyControls`. DS shortlist/event eligibility; AI introduction/plan coordinators | Owner ACKs; module allowlists via `node scripts/discovery-config.ts`; card-level report UI (DS component); AI proposal job; CS-R3 event pages; real Apify ingestion calling `upsert_catalogue_event`, deployed two-account verification |
| Deployment | Offline code/test evidence and attributed isolated Droid evidence. **Deployed:** SpacetimeDB module on Maincloud as `dor` (owner Nimisha; first published from main `53795c2`, republished from `3bf3e25`, 2026-10-24), Clerk issuer/audience (`dor-spacetimedb`) set; **live:** hosted non-owner smoke 26/26 (Adam, worker stopped, no paid calls). The hosted module predates D044 (main `1b65c9e`) | Republish for D044 (owner), `--sweep` owner run, D041/D043 live checks, worker Stage C, app hosting; full app + database + providers together; no end-to-end live claim yet |

No full deployed end-to-end evidence is established. Do not confuse LocalVault's adapter status or a live-worker factory name with an integrated/deployed application. The C8 discovery contract is a proposal; no runtime schema was changed by this README/INSTRUCTIONS move.

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

## Historical reset verification — main d7285eb plus documentation changes
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

## Hosted SpacetimeDB — Maincloud `dor` (DS, 2026-10-24; latest status requires owner confirmation)
- **Planned:** one shared hosted database for app, worker, Cyber tests and DS (`docs/team-messages/maincloud.md`, the source of truth for current hosted state).
- **Deployed:** first `spacetime publish -s maincloud --module-path spacetimedb -y dor` from main `53795c2`, then republished from main `3bf3e25` (empty migration plan, data kept, never `--delete-data`). Database identity `c200c206…dc14`; `module_owner` = Nimisha's login. Expiry sweep scheduled (60 s); discovery allow-lists loaded with extensions off; Clerk issuer and audience set (audience renamed to `dor-spacetimedb`; removing the old `kinetic-spacetimedb` entry is an owner step, check with `SELECT * FROM auth_audience`). The only allow-listed worker is Adam's `0xc200188a…5ce5`; the unused `c200f05e…78c6` was removed.
- **D044 status:** this ledger originally said the hosted module predated D044. The owner has since reported that the D044 backend is live on Maincloud. This PR does not connect to or change Maincloud; record a fresh two-account verification separately before calling this workspace live-verified.
- **Live-verified:** 8/8 anonymous/worker denial checks (DS, before the issuer/audience were set), then `scripts/smoke-core3.ts` 26/26 run by a non-owner (Adam, `SMOKE_TAG=adam`, worker stopped, no paid calls; details in the team message).
- **Not verified:** `--sweep` expiry (owner run), D041 pause and D043 nudge row live, Clerk sign-in through the browser app, worker delivery (Stage C), hosted app, D044 anywhere live.

## Relationship books follow-up — offline status

The current CS/Cyber work adds an expandable book to each accepted connection. Selected photos, manually entered calls, user-linked introductions, and nudge feedback are stored in the user's encrypted local vault. Photos are not fetched through Apify or social media; call history is not imported. Cyber added pair-scoped encrypted record types, strict validation and an IndexedDB v1→v2 additive migration (D049). CS added the local vault interface and Connections UI. D044's explicit owner-enabled named-pair standing-consent requirements and recipient/server gates are unchanged.

**Evidence:** latest main `fb5dfa4` merged; typecheck passed; vault tests 20/20; contract check 131/131; app build passed; `git diff --check` passed. Browser/photo/network behavior, deployment, and provider integrations have not been verified. See `docs/features/RELATIONSHIP_BOOKS.md` and `docs/handoffs/cs.md`.
