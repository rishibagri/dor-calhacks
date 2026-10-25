# CYBER handoff (Sumedh): current, Core 2 (D041 recipient pause)

## Relationship books (D049) — 2026-10-25

**Status:** Cyber-owned encrypted local persistence implemented; offline verified only. No commit or push. The local book API is implemented in `src/vault/local-vault.ts`; CS owns the frontend `VaultPort` in `src/lib/backend/ports.ts`.

- Photos: user-selected JPEG/PNG/WebP data URLs, strict base64/MIME/size checks, ≤1.5 MiB decoded and ≤24 photos per pair; encrypted per record in IndexedDB v2.
- Interaction rows: `call | nudge_received | introduction`; local only. `nudge_received` requires an opaque source ID and allowlisted fixed template ID, may update its outcome, and upserts by pair/source/kind while preserving the initial row ID and first-seen time.
- Pair-scoped list/delete; interaction and photo caps; v1-to-v2 IndexedDB upgrade preserves existing stores and rows. Vault lock rejects reads/writes; UI must clear/unmount decrypted data on lock.
- Exact methods and types: `saveRelationshipPhoto`, `listRelationshipPhotos`, `deleteRelationshipPhoto`, `saveBookInteraction`, `listBookInteractions`, `deleteBookInteraction`; exported local types in `src/vault/book-types.ts`. No wire contract, Apify, provider, URL fetch, raw calls, or shared DB data.
- Verification: root `npm run check` passed (contracts 131/131); `node --test src/vault/__tests__/vault.test.ts` passed 20/20. CS reported an integrated typecheck is running; Cyber should not run a concurrent build/typecheck. No browser or live IndexedDB verification.

**CS next:** ACK D049 and use the exported local types; render current caller-filtered nudges as `nudge_received` with `sourceId` + `templateId`, update `outcome` on the same row, and clear decrypted photo/interaction state immediately on vault lock. Do not send local content back to SpacetimeDB or a provider.

Status: implemented offline on `role/cyber-privacy` (on main `126f072`, including #30 and #31). Not published or live-verified.

## Reviews done
- **CS #30 index rewrite:** ACK, no leak. Caller filters are unchanged in meaning; `pair_member` is consistent on invite, accept, unlink and re-pair; nothing new is visible to a third account (`src/privacy/REVIEWS.md`).
- **AI D040 private assessment:** ACK with 4 conditions. The main one: it may offer a pause but never set one, and `ShareReview` approval stays mandatory (`src/privacy/REVIEWS.md`).

## D041 as built
| Piece | Name |
|---|---|
| Set / extend | `pause_recipient({pair_id, expires_at, expected_version})`: 15 min to 30 days; revokes the owner's standing approvals and C7 approvals in the pair, suppresses their nudges |
| Resume | `resume_recipient({pair_id, expected_version})`: restores nothing |
| Owner view | `my_recipient_pauses {pair_id, version, expires_at, active, created_at}` |
| Enforcement | `approve_signal` (`unauthorized: recipient_paused`), `worker_signal_context` (omitted), `commit_nudge` (`stale: revoked`, same as revocation), `my_nudges` (hidden) |
| Expiry | `sweep_expired` marker `pause:<id>:<version>`; fail closed until swept |

## Evidence (offline, provider keys stripped)
- `check:all` exit 0: contracts 124, schemas current, module 170, typecheck, app 275 + 1 known todo.
- `ai:check` exit 0: agents 69, worker 42, worker integration 36.
- `next build --webpack` ok.
- Mutation checks: 16 of 16 caught (12 pause guards incl. defence-in-depth, 3 #30 filters, 1 refusal-indistinguishability).

## Exact next actions
- **CS (Rishi):**
  1. Regenerate bindings.
  2. Add pause/resume controls in Connections and Privacy over `pause_recipient`, `resume_recipient` and `my_recipient_pauses`, joined to `my_pairs`. Show the end time; never ask for a reason.
  3. Copy: "{name} isn't notified"; anything already shared is withdrawn; a nudge they already saw will disappear.
  4. The decision loop may *offer* a pause for an excluded person; only the owner's tap sets it.
- **Adam:**
  1. No worker code change is needed (preferred design).
  2. Please add `worker/integration` cases: pause before the job, pause during generation, pause then resume (the old signal stays dead), and the fallback path. Expect `policy_denied`.
  3. Keep D040 conditions 1–4.
- **Nimisha:** add the paired evals: same availability, Alex paused vs Jo not; and pause-then-resume never revives.
- **Cyber next (Core 3):** live two-account plus denied-third run of the pause and revoke-during-generation cases once CS publishes; recipient-visible surface inspection.

## Deferred to the front-end pass
- Raw server text in `discovery-profile.tsx` / `discovery-area.tsx` (see the Core 1 section below).

---

# CYBER handoff (Sumedh): Core 1 (superseded by Core 2 above; the D040 number there was reassigned, so the pause is D041)

**Plan change (README #26, sponsor feedback):** Core 1–4 are the active milestones, and R0–R6 are historical. The core product is the existing-relationship flow: private reflection → clarify → exact named-recipient approval → guarded delivery → dismiss/pause/revoke. Discovery, events and Apify are preserved extensions with their guards intact, not core dependencies.

Status: Core 1 proposal on `role/cyber-privacy` (on main `71c3b6a`). **Proposed, not wired.**

## Core 1 deliverable (D040)
- `src/privacy/RECIPIENT_PAUSE.md`: episode exclusion (device-only) vs recipient pause (owner-only server record); transitions; enforcement at approval, use and commit; refusal reported as `revoked`; recipient-visible surface review; owner copy; review asks; 10 rejection cases for Core 2; file claims; open questions.
- `contracts/src/recipient-pause.ts`: reference guards `guardPauseRequest`, `pauseActive`, `guardNotPaused`, `pauseInvalidates`, `previewRecipients`, with 7 tests. Nothing consumes them yet.
- Evidence: `npm run check` exit 0 (contracts 123, schemas current); module typecheck ok.

## Exact next actions
- **CS:** review §2–§3 names, the §1 escalation rule, the §5 badge/count rows and the §6 copy; claim the pause UI and the episode exclusion in journal/share review.
- **Adam:** review §7. Device-only `excludedRecipients`; suggestions only; nothing in worker requests or prompts. Share the assessment/clarification seam when specified, so Cyber can review it against D040.
- **Nimisha:** §8 cases as no-action evals; paired fixtures (same availability, Alex excluded vs Jo not).
- **Cyber after ACK (Core 2):** `recipient_pause` table and reducers, `guardNotPaused` in `approve_signal`, use checks and `commit_nudge`, invalidation, sweep, owner pause control model, §8 tests.
- **Extension backlog (lower priority):** a preset-schema change so CS can offer `activity_interest` (PR #24 note); D028 review of CS's Apify config; DS asks from #25 (event-ID validator, linked pairs on discovery cards).

## Deferred to the front-end pass
- Raw server text in `discovery-profile.tsx` / `discovery-area.tsx` (see below).

---

# CYBER handoff (Sumedh): CYBER-R3 (historical; superseded by Core 1 above)

Status: implemented on `role/cyber-privacy` (on main `2b8e59b`, after R2 PR #18 merged). Offline-verified only: the module is unpublished, there's no live Apify source, and discovery stays behind the off-by-default flag.

## What R3 added (D039)
| Protection | Where | Evidence |
|---|---|---|
| Catalogue records only from the server ingester; default-deny normalization (no venue/attendee fields), allowlisted topics/areas/hosts, sanitized titles, no rollback; public view not joined to users | `upsert_catalogue_event`, `guardCatalogueEvent`, `catalogue_events` | `spacetimedb/tests/events.test.ts`, `contracts/tests/events.test.mjs` |
| Event intents: explicit, usable events only, end with the event, every change bumps the version; overlap visible only mutually and only to people who can see your card; kind never shown | `publish_event_intent`, `revoke_event_intent`, `event_companions`, `my_event_intents` | mutual-only, block, other-area, revoke tests |
| C7 for existing pairs: preset-only `activity_interest` (off by default), item approval with named counterpart, exact topics, previewed versions, ≤ 24 h | `approve_activity_interest`, `activityApprovalStands`, `my_activity_approvals` | off-by-default, version, outsider, tightening tests |
| D034 lifecycle adopted: both accept the same revision while every source holds; participants from the basis; times from the catalogue | `commit_plan_proposal`, `revise_plan_proposal`, `respond_plan`, `cancel_plan`, `planSourceCheck`, `my_plans` | wrong user/revision, one-sided, revoke-after-first-accept, block, cancelled/stale/moved event, decline privacy |
| Worker-only plan inputs | `worker_plan_candidates` | worker-only, no names/titles test |
| Exact preview copy and withdrawal controls for CS | `src/features/privacy/event-consent-model.ts`, `event-privacy-controls.tsx` | `event-consent-model.test.ts` (6) |
| Venue tags review | `src/privacy/DISCOVERY_ENFORCEMENT.md` | not added; no habitual-visit disclosure |

## Verification
- `npm run check:all` exit 0: contracts 116, schemas current, module 137, typecheck, app 193 + 1 known todo.
- `npm run ai:check` exit 0: agents 64, worker 21, worker integration 19.
- Mutation checks: 23 of 23 caught.
- Not run: `next build` (the new components aren't imported by any page yet). Not proven: live Apify, deployed isolation, real scheduler, browser.

## Exact next actions
- **CS:**
  1. ACK D039.
  2. Regenerate bindings.
  3. Set `source_hosts`.
  4. Make real ingestion call `upsert_catalogue_event`.
  5. Use the preview copy verbatim.
  6. Add an owner-confirmed `activity_interest` preset toggle (off by default).
  7. Compose `<EventPrivacyControls>` and plan acceptance using `my_plans`.
- **Adam:**
  1. Build plan options only from `worker_plan_candidates`.
  2. Commit via `commit_plan_proposal` with the row's ids and versions unchanged, and use `revise_plan_proposal` after catalogue changes.
  3. Refusals mean no plan.
  4. `same_event` introduction proposals still need a shape change before the guard can accept them.
- **Nimisha:** event companions = `event_companions` rows only (mutual, visible). Keep the D039 rejection cases as no-action evals.
- **Cyber next:** CYBER-R4 adversarial suite (rate limits on remaining reducers, account switch, browser vault), then R5 live replay.

## Deferred to the front-end pass (owner decision, 2026-10-24)
- **Raw server text in Discover forms (CS files):** `discovery-profile.tsx` and `discovery-area.tsx` show reducer refusals through `ResultNotice`, which prints the raw `code: message`. These should go through fixed copy (`messageForError` from `src/features/privacy/introduction-model.ts`, or an equivalent map). Non-blocking: the text only describes the caller's own state. Pick this up with Rishi when the front end is worked on.

## Blockers
None offline. Live proof needs a published module, real ingestion and two real accounts.

---

# CYBER handoff (Sumedh): CYBER-R2 (superseded by R3 above)

Status: implemented on `role/cyber-privacy` (on main `030ead2`), **uncommitted working tree; the user commits and opens the PR.** Offline-verified only; the module is unpublished and discovery stays behind the off-by-default flag.

## What R2 added (D038)
| Protection | Where | Evidence |
|---|---|---|
| Introduction requests: human-triggered, only to a card visible now, idempotent per sender id (a replay never revives), ≤ 72 h; recipient alone accepts/declines, sender alone cancels; accepting creates no pair or other sharing | `reducers/introductions.ts`, `guardIntroductionRequest/Response`, `introduction` table, `my_introductions` | `spacetimedb/tests/introductions.test.ts` |
| No decline oracle: the sender sees accepted / pending / closed; a pending request and the 30-day cooldown give one message | `my_introductions`, `introductionErrorMessage`, sweep `sender_closed` | decline vs no-answer test; contracts cooldown test |
| Block from a card or an introduction; report with a coarse reason (private, also blocks); cascades end pending and accepted introductions and proposals | `discovery_effects.ts`, `block_introduction_participant`, `report_discovery_user`, `discovery_report` | report privacy, block-from-request, block-during-pending tests |
| Withdrawal and profile edits close dependent requests and proposals | `closeDiscoveryLinks`, `stalePublicationDependents` | withdraw/edit during pending tests |
| Repeat-probe and spam limits per caller per day: 10 requests, 20 blocks, 10 reports, 4 area changes, 20 publishes; ≤ 5 pending | `guardRateLimit`, `consumeRate`, `rate_window` | one test per limit, per-caller isolation |
| Worker-only commit of AI introduction proposals: visibility, both versions and current tag overlap rechecked; viewer-only view rechecks live | `commit_introduction_proposal`, `guardIntroductionProposalCommit`, `my_introduction_proposals` | withdraw/block/area/edit during generation, model-widened proposals, defence-in-depth view test |
| Introduction safety controls component | `src/features/privacy/introduction-{model,controls}` | `introduction-model.test.ts` (5) |
| Enforcement matrix for CS | `src/privacy/DISCOVERY_ENFORCEMENT.md` | — |

## Verification
- `npm run check:all` exit 0: contracts 105, schemas current, module 113, typecheck, app 186 + 1 known todo.
- `npm run ai:check` exit 0: agents 64, worker 21, worker integration 19.
- Mutation checks: 20 of 20 caught (rate limits, cascades, decline mask, worker check, authority, versions, tag overlap, view rechecks).
- Not run: `next build` (the new component isn't imported by any page yet). Not proven: deployed isolation, real JWT mapping, the real scheduler, browser rendering, two real accounts.

## Exact next actions
- **CS:**
  1. ACK D038 and the file claims.
  2. Regenerate bindings (new reducers and the `my_introductions` / `my_introduction_proposals` views).
  3. Compose `<IntroductionControls>` (`src/features/privacy/README.md`) and card-level block/report on Discover.
  4. Send a fresh random `client_request_id` per tap, and reuse it on retry.
  5. Never show a decline to the sender.
  6. Enable discovery only after the ACKs.
- **Adam:**
  1. After generation, commit proposals through `commit_introduction_proposal` with the worker identity (args in `src/privacy/README.md`).
  2. Treat refusals as no proposal.
  3. `same_event` waits for R3.
- **Nimisha:** rank only `discovery_cards`. Already-connected and pending pairs are refused at commit, so filtering them out early saves model calls. Keep the D038 rejection cases in `src/privacy/REVIEWS.md` as eval no-action cases.
- **Cyber next:** CYBER-R3 (event intents, C7 activity approvals, plan finalization guard); R5 live replay of `DISCOVERY_ENFORCEMENT.md`.

## Blockers
None for offline work. Live proof needs a published module, the Clerk `aud` set up and two real accounts.

---

# CYBER handoff (Sumedh): CYBER-R0/R1 (superseded by R2 above)

Status: implemented on `role/cyber-privacy` @ `0021c16` + `9b82854`, on main `fab86d6`. PR #10 to main is open. **Offline-verified only.** The module is unpublished, so nothing here is live.

## What R1 added (D035)
| Protection | Where | Evidence |
|---|---|---|
| Recipient support-preference consent: recipient-owned, versioned, ≤ 30 days, revocable; never visible to the sender | `support_preference`, `reducers/preferences.ts`, `my_support_preferences`, worker-only `worker_support_preferences` | `spacetimedb/tests/preferences.test.ts` |
| `commit_nudge` binds `recipient_consent_id/version`; the guard needs that exact current consent, standing and covering the mode; expiry is clamped to it | `guardNudgeCommit`, `reducers/coordination.ts` | revoke/edit during generation, borrowed id, wrong caller, mode outside consent, replay binding |
| JWT `aud` allowlist, fail closed | `auth_audience`, `requireAuthenticated`, `set_auth_audience` | same-issuer foreign-audience token refused |
| Expiry and snooze reach clockless views | `sweep_expired` (60 s, internal), `expired_record`, `my_nudges` | expired nudge, signal and preference; snooze hide and reappear |
| Proposed C8: exact publication preview, configured coarse areas, reciprocal same-area audience, withdraw, block both ways, bounded cards; flag off by default | `contracts/src/discovery.ts`, `reducers/discovery.ts`, `discovery_cards` | `contracts/tests/discovery.test.mjs`, `spacetimedb/tests/discovery.test.ts` |
| Privacy controls over the real LocalVault | `src/features/privacy/` | `vault-controller.test.ts` (10) |

## Verification
- `npm run check:all` exit 0: contracts 84, schemas current, module 84, typecheck, app 141 + 1 pre-existing DS todo.
- `npm run ai:check` exit 0: agents 45, worker 10.
- `npx next build` ok; `npm audit` 0.
- Mutation checks: 19 of 20 caught. The uncaught one, revoke without a version bump, is redundant with `revoked_at`.

## Exact next actions
- **CS:**
  1. ACK D035 and the file claims (`docs/updates/cyber.md`).
  2. Set a fixed `aud` claim in the Clerk JWT template. After publish run `set_auth_issuer` **and** `set_auth_audience`.
  3. Confirm one `expiry_sweep` row exists.
  4. Compose `<VaultControls vault={vault} />` with the per-account LocalVault.
  5. Build the preference settings UI: default no consent; show expiry; renew and revoke.
  6. Regenerate bindings.
  7. Discovery: set the tags/areas allowlists, but enable only after the C8 ACKs.
- **Adam:**
  1. Map `worker_support_preferences` into `RecipientPreferencesPort` (`src/privacy/README.md`).
  2. Pass `ack.recipientConsentId/Version` into `commit_nudge`.
  3. Change `DiscoveryTagSchema` to hyphenated slugs.
  4. Expect `stale: revoked`, `stale: stale_policy` and `unauthorized: no_consent|blocked_category` at commit. These are worker-only outcomes, never shown to the sender.
- **Nimisha:** rank from `discovery_cards` only (published tags + `shared_tags`). Never use private extras.

## Known gaps
- Views can't check `aud`.
- View expiry is bounded by the 60 s sweep, which scans whole tables; markers are never pruned.
- No rate limits.
- C8 introductions, report, invite/probe limits and event intent are R2/R3.
- Not verified yet: real-browser vault/controls, live two-account smoke.

---

# Planning reset notice — current main d7285eb

Read `docs/roles/cyber.md` and README **R0–R6** for current assignments. The historical implementation handoff below is preserved; statements such as “not merged” describe its original commit. Current status is in PROJECT_KNOWLEDGE.md. This notice is not a consumer ACK or evidence of live verification. New scope: existing connections + opted-in nearby public profiles + local-event introductions. One-time approximate location; no inherited pair consent. Forwardable update: `docs/team-messages/cyber.md`.

---

# Current coordination update — Sumedh (Cyber)

Read your updated detailed plan in docs/roles/cyber.md and shared README.md phases. Task IDs are CYBER-P#; Cyber uses CYBER-P#. CS owns Apify ingestion; Nimisha matching; Adam bounded proposals; Sumedh disclosure/vault. Preserve existing work and review the main/role-branch status before selecting the first unmet phase. Forwardable message: docs/team-messages/cyber.md. This notice does not ACK or complete any pending implementation/contract review.

---

# CYBER handoff (Sumedh)
Status: CYBER-P2/P3 implemented on `role/cyber-privacy` @ `34e70f7`. Offline-verified only. Nothing is published or live. Main merged in at `982cfb0`; no reset, M1 work preserved.

## What exists now
- **One disclosure policy (D026).**
  - `contracts/src/policy.ts` has no runtime dependencies and is the only place the semantics live: `evaluateDisclosure` (F3, using CS's FLOWS order and reasons), `guardApproval` (F4), `guardSignalUse`/`guardSignalStanding`, `guardNudgeCommit` (F7 plus the F5 gate), `nudgeDelivery`, `templateForSignal`, `sameApprovedPayload`, `payloadRevision`, `policyErrorCode`.
  - CS's `previewDisclosure` delegates to it. A 128-combination test proves device preview and reducer agree.
- **Authoritative module (direct reducer/view calls tested):**
  - `approve_signal` (guarded)
  - `set_nudge_delivery` (recipient-owned; no row = off)
  - `set_worker_identity` (owner-only; worker can't hold an account)
  - `commit_nudge` (worker-only): source recheck, template ↔ approved mode, quiet hours, 24h cooldown counting all nudges, idempotent, no resurrection
  - views: `my_signals`/`my_receipts` sender-only, `my_nudges` standing recheck, `my_nudge_delivery`, worker-only `worker_signal_context`/`worker_delivery`
- **Real vault:** `src/vault/` `LocalVault` implements `VaultPort` (journals, reflections text-only, profile, quiz extras) with create/unlock/lock/auto-lock/recover/changePassphrase/destroy. Design: `src/vault/DESIGN.md`.
- **C7/Apify boundary (D028):** `guardPublicCatalogueQuery`, `safeCatalogueUrl`, `src/privacy/ACTIVITY_CONSENT.md`.
- **Reviews:** `src/privacy/REVIEWS.md`. D016–D020 ACKed; D021 ACKed with conditions (#4 preferences storage gap, #5 outcomes never sender-visible); D015 ACKed.

## Verification (actual, offline)
- `npm ci && npm run check:all` exits 0: contracts 63/63, schemas current, module 52/52, app typecheck, app tests 79/79 (vault 17).
- `npm run ai:check` exits 0 (agents 34, worker 6). `npx next build` ok. npm audit 0.
- Each commit builds and passes contract tests in isolation.
- Mutation checks: removing any one of these fails tests:
  - opt-in, delivery gate, template check
  - source recheck, worker check, worker-view gate, replay resurrection
  - record AAD, fixed IV, key extractability, lock, recovery rotation
- Bug found and fixed before merge: the worker views compared `find() !== undefined`, but SpacetimeDB's `find` returns `null`, so the views were visible to every caller.
- **Not verified:** a published module, the real Clerk JWT mapping, concurrent transactions, the CLI bundling of `@dor/contracts/policy`, or the real-browser vault (pagehide, on-disk IndexedDB). Offline harness results do not prove deployed isolation.

## Consumer and exact next action
- **CS:**
  1. ACK D026/D028, the VaultPort additions and the file claims (AGENTS.md handoff log).
  2. Wire `LocalVault` with a per-account `IndexedDbVaultStore` name, plus vault screens.
  3. Device preview, then `approve_signal` with `payloadRevision`.
  4. Opt-in UI.
  5. Apify inputs via `guardPublicCatalogueQuery`.
  6. Publish, `set_worker_identity`, two-account live smoke.

  Exact steps: `src/privacy/README.md` "Integration instructions".
- **AI:**
  1. `DisclosurePolicy` over `worker_signal_context` (field mapping in the README); `worker_delivery` for `DeliveryStatePort`.
  2. Commit via `commit_nudge`.
  3. Never show outcomes or ACKs to the sender.
  4. Persist reflection text only.
- **DS:** assert the gate reason codes in no-action cases. Private-extras ranking stays on device.

## Blockers / open
- Recipient support-preferences consent table is missing, so live coordination stays fail-closed.
- No scheduled expiry sweep.
- JWT `aud` is not checked.
- No rate limits.
- `spacetime` CLI is unavailable here.

## Planned (Cyber next)
1. Recipient-preferences consent reducer and guard, bound into `commit_nudge`.
2. Expiry sweep.
3. Audience check, with CS.
4. Rate limiting and repeated-probe tests.
5. Local journal delete → derived-signal revocation flow, with CS.
6. Provider and log leak review.
7. C7 type review when CS proposes it.
