# dor — current project knowledge

## Reset baseline and priority
Inspected main **d7285eb** includes Cyber's real vault/F5/F7 work plus AI PR #7 and DS PR #8. The user requested a README/phase reset, not a code reset. Old P-phase assignments are superseded by README/docs/roles R0–R6; historical logs/handoffs retain their original commit-specific evidence. No teammate branch is reset.

Product: AI helping people connect with people. Three experiences: existing partner/friend/family relationships; nearby opted-in public profiles; same-local-event connections. User confirmed **one-time approximate location** and **public opt-in profiles visible before invitation acceptance**. Quiz remains 6–8 questions/skippable; all four personalization dimensions; explicit sharing confirmation. Discovery publication is separate from pair presets. Journaling is optional for finding people/events.

## Current implementation ledger

| Area | Implemented on inspected main | Still required |
|---|---|---|
| App / identity / bindings | Next.js pages, quiz, Clerk-aware routes and Spacetime client adapter | Replace composition-root placeholders; actual generated bindings, configured identities and deployed browser verification |
| Vault | `LocalVault`, Web Crypto, IndexedDB adapter, recovery/lock lifecycle, profile/extras and reflection-text storage | Wire per-account instance and UI; real-browser persistence, pagehide and account-switch checks |
| Existing connection guards | One shared policy; guarded approval, opt-in/delivery, worker-only commit, caller-filtered views | Authoritative recipient support-preference storage + commit binding; expiry/snooze visibility; JWT audience; scoped rate limits |
| AI / voice | Claude/Cartesia adapters, authenticated routes, browser voice helpers; real-policy worker factory and replay ledger | Journal UI and database adapters, browser/provider live runs, deployed worker |
| Droid efficiency | Haiku default and reused private working directory; Adam recorded isolated live comparisons | Concurrent execution/total deadlines; independent whole-pipeline cost and quality measurements |
| DS | Quiz fixtures, 30 support cases; ACK rank hook; 12 activity cases, ranker and baseline results | Reviewed canonical C7/C8 exports, nearby/event cases, independent human usefulness ratings |
| Apify | Executable input/link guards in `contracts/src/catalogue.ts` | Actual selected source/Actor, ingestion/cache, catalogue schema and live retrieval |
| Nearby / event introductions | Offline only, behind the off-by-default flag (role/cyber-privacy, D035/D038): proposed C8 publication/area/block guards; introduction request/accept/cancel with no decline oracle, report, per-caller limits, worker-guarded AI proposal commit; `IntroductionControls` component. DS shortlist; AI introduction coordinator | Owner ACKs, CS composition and bindings, event intents (R3), deployed two-account verification |
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
