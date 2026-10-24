# Cyber privacy reviews (Sumedh)

## 2026-10-24: D016–D020 core flow (CS draft), ACK with reconciliation (D026)
| Decision | Verdict | Where enforced now |
|---|---|---|
| D016 device-only preview | **ACK.** `previewDisclosure` now delegates to the single Cyber-owned `evaluateDisclosure` (`contracts/src/policy.ts`). `approve_signal` enforces the same function via `guardApproval`, so preview and reducer cannot drift (128-combination agreement test). | `contracts/src/disclosure.ts`, `policy.ts`, `spacetimedb/src/reducers/signals.ts` |
| D017 opt-in per connection, default off | **ACK, implemented.** `nudge_delivery` row written only by the recipient (`set_nudge_delivery`). No row means not opted in. Opting out suppresses pending nudges. | `spacetimedb/src/reducers/delivery.ts`, `guardNudgeCommit` |
| D018 quiet hours / 24h cooldown | **ACK, implemented at commit.** Cooldown counts *every* nudge in the pair (including dismissed/suppressed ones), so revoke-and-retry can't reset it. DST drift is accepted as documented. | `commit_nudge` |
| D019 space ⇒ no candidate | **ACK.** The preview returns `nothing_to_share`. `approve_signal` rejects an empty payload (`invalid_schema`). Producing no candidate is AI's responsibility. | `evaluateDisclosure`, `guardApproval` |
| D020 ownership; availability-only ⇒ no nudge | **ACK.** `templateForSignal` moved into `policy.ts`. `commit_nudge` rejects any template not derived from an approved support mode (`blocked_category`). | `guardNudgeCommit` |

Reason-code alignment adopted from FLOWS (supersedes my M1 codes):
- A pending pair gives `no_consent`.
- An assignment pointing at a different preset gives `stale_policy`.
- A preset owned by someone else gives `wrong_recipient`.

Membership is still checked first in reducers, so non-members get `not_found`.

## 2026-10-24: D021 (Adam), merged AI contracts and adapters
Overall: **ACK with conditions.** The interfaces are enum-only and fail closed. The open conditions are about storage and visibility, not shape.
1. **`PrivateReflection` (C1): ACK.** Persist the reflection *text* only (`VaultPort.saveReflection`, ≤2000 chars). Do **not** persist `candidate`: FLOWS F2 holds it in memory, and re-previewing a stale candidate later would be a new disclosure decision on stale context.
2. **`SignalCandidateSchema` reuse: ACK.** Strict and enum-only. AI must emit `candidate: null` for space/no-need (D019).
3. **`VoiceSession`: ACK, with conditions for the route.** Serve with `cache-control: no-store`. Never log the token or persist it in the vault, localStorage or React state beyond the call. The 60-second scope is acceptable. An XSS in our origin could read it during that window (documented residual risk).
4. **`RecipientSupportPreferences`: implemented in CYBER-R1 (D035), offline only.** `support_preference` table, `set_support_preferences` / `revoke_support_preferences`, worker-only `worker_support_preferences`, and `commit_nudge` binding `recipient_consent_id/version` (see README "Semantics"). Original finding kept below for history.

   **Original finding: BOUNDARY GAP (blocking for live coordination).**
   - It is the recipient's consent record, but there is no authoritative store. The worker's `RecipientPreferencesPort` therefore has no real backing, and the coordinator correctly returns `preferences_unavailable`.
   - Needed (CS module + Cyber guard): a recipient-owned row written by `set_support_preferences` (caller = recipient, accepted pair, ≤ 24h or explicit expiry, revocable), plus a worker-only view.
   - `commit_nudge` should then also bind `recipientConsentId/Version`. Until that lands, live coordination must stay fail-closed. Do not substitute fixture preferences in live mode.
5. **`CoordinationOutcome` codes leak recipient state if shown to the sender.** `not_opted_in`, `quiet_hours`, `cooldown`, `recipient_declined` and `preferences_unavailable` all describe the *recipient*.
   - Outcomes must be visible only to ops/worker logs, never to the sender.
   - The sender UI may say at most "no nudge was sent", or nothing.
   - The same applies to `AgentAck`: it must never be stored in a sender-visible view (no implicit return disclosure).
6. **Coordinator re-checks** (policy → delivery → preferences → proposer → recheck all three): ACK. Final authority is now `commit_nudge`, which re-checks consent and F5 at commit. Nudge expiry is consistent with it: min(source expiry, now + 24h).
7. **Worker HTTP** (≥32-character bearer, timing-safe compare, 4 KB cap, no body logs): ACK.
   - Keep the HTTP bearer and the SpacetimeDB worker identity separate secrets, and rotate both.
   - The worker identity is allow-listed with `set_worker_identity` and cannot hold an account.
8. **Factory/Droid sessions** hold approved enums only. They are still a disclosure to Factory, and retention is *unverified*. `PROVIDER_PROCESSING` copy is accurate. Do not claim zero retention.
9. **Deterministic `nudgeId(requestId, …)`:** compatible with `commit_nudge` idempotency, where a replay is a no-op and a different payload under the same id is rejected.
10. **Real policy in the worker:** use `DisclosurePolicy` with a reader over the new `worker_signal_context` view (see README "Integration"), and `worker_delivery` for the `DeliveryStatePort` pre-check.

## D015 fixture preset records (CS)
ACKed in my M1 log. `presetConfirmation` is fixture metadata, not an authorization input. Far-future fixture expiries must not become runtime defaults.

## 2026-10-24: C8 discovery proposal (D030/D031), Cyber review (CYBER-R0/R1)
Verdict: **ACK the separation, with the permitted fields and rejection cases below.** Implemented as proposed guards (`contracts/src/discovery.ts`) plus module transitions behind an owner feature flag (default off). Needs CS/DS/AI ACK before enabling.

**Kept separate (no silent extension):**
- Discovery reads no C2/C3/C4 state: no preset, assignment, approved signal, support preference or delivery row. Pair membership never grants discovery visibility, and discovery never grants pair sharing (test: a stranger who discovers you still sees none of your pair state).
- Apify inputs are unchanged (D028). No area key, tag choice or profile field enters `guardPublicCatalogueQuery`.
- Quiz answers and extras never pre-publish anything; publication is its own explicit call.

**Permitted fields (peer-visible projection `discovery_cards`):** opaque `card_ref` (random publication id, never an identity), `display_name` (≤ 40 chars, NFKC, no contact or identifier patterns, no bidi/zero-width), `interest_tags` (≤ 8, developer allowlist), `shared_tags` (overlap with the viewer), `revision`. Nothing else: no area key, expiry, account, pair, preset, preference, quiz, journal or location.

**Rules enforced now:**
| Rule | Where |
|---|---|
| Discovery off until the owner enables it | `requireDiscovery`, `discovery_cards` |
| Exact preview: unknown keys rejected, allowlisted tags, notice version, duration ≤ 7 days | `guardPublicationDraft` |
| Area = one configured coarse key; coordinates, geohashes and finer cells refused; ≤ 24h; no background refresh | `guardAreaKey`, `set_discovery_area` |
| Audience = registered, currently published participants in the same area (lurkers see nothing) | `guardDiscoveryVisibility` |
| Withdraw is immediate, ends area participation, idempotent; republish = new explicit revision | `withdraw_discovery_profile` |
| Block hides both people at once, never shown to the target; unseen card or self → `not_found` | `block_discovery_user`, `blockedEitherWay` |
| Expiry reaches the clockless view through sweep markers (≤ 60 s window) | `sweep_expired` |
| Bounded result (≤ 50), no directory | `discovery_cards` |

**Rejection cases each consumer must keep (direct calls):** disabled flag; unauthenticated/unregistered caller; unpublished viewer; expired or withdrawn publication or area; other area; block in either direction; forged owner/record mismatch; contact details in the name; non-allowlisted tag; non-configured area; stale notice version; stale `expected_revision`.

**R2 items now implemented (D038, see the next section):** introduction proposal commit, request/accept, report, invite and repeat-probe limits. **Still open:** avatar media path, event intent (C7/C8, R3). Exact area resolution, publication duration and audience defaults still need owner confirmation; the current numbers are the LOCAL_CONNECTIONS proposals.

**Review checklist assigned:** CS: UI copy for audience and duration, the device-side coarsening to a configured area, the flag rollout. DS: rank only `discovery_cards` rows (published tags), never private extras. AI: agent prompts get tags and opaque refs only; recheck visibility at commit.

## 2026-10-24: C8 introductions, report and limits (CYBER-R2, D038)
Verdict: **implemented as proposed guards and module transitions behind the same flag.** CS (producer), AI and DS (consumers) review pending. Matrix: `DISCOVERY_ENFORCEMENT.md`.

**Design choices to review:**
- Accepting an introduction creates no pair. Turning a connection into a support relationship still goes through the existing pair invite and named C2/C3 approvals.
- No decline oracle: the sender sees accepted | pending | closed, a decline stays "pending" until the original expiry, and a pending request and the 30-day cooldown share one error message. The cooldown is anchored on the original expiry, not the decline time.
- A sender's profile edit closes their pending requests, so the recipient never accepts a profile they weren't shown.
- Report = coarse reason + block. No free text, because it would reach moderators verbatim and could carry personal data.
- Rate limits count successful actions (failed reducers roll back). Probing stays uninformative through uniform `not_found` and random refs.
- AI proposals: the worker commit rechecks everything at commit time; the view rechecks again live; `same_event` is refused until event intents exist.

**Rejection cases consumers must keep:** third-account action on someone else's introduction; sender accepting; recipient cancelling; replay after decline; request-id reuse for another person; accept after expiry, withdrawal, profile edit or block; request to an unseen, other-area or own card; free-text report reason; proposal after withdrawal, block, area move or edit during generation; proposal tags outside the overlap; `same_event` before R3; non-worker commit.

## 2026-10-24: D034 plan lifecycle (Adam) and C7/C8 events (CYBER-R3, D039)
Verdict on D034: **ACK; adopted as the reducer finalization guard, unchanged.** `applyPlanAction` takes the actor from `ctx.sender`, and the reducer computes `PlanSourceCheck` in the same transaction:
- `eventScheduled` also requires a fresh copy (≤ 48 h) and an unmoved start time.
- `intentsCurrent` also requires both bound intent versions and the basis (accepted introduction, or pair + both C7 approvals).

Two conditions for consumers:
1. Show acceptance state only to its owner until "confirmed".
2. Never turn a confirmed plan into an external action.

**C7 (ACTIVITY_CONSENT.md §2) as implemented:**
- `activity_interest` is preset-only. It is not in `SHARING_CATEGORIES`, so ApprovedSignal v2 can't carry it.
- The quiz can't nominate it; it is off until the owner adds it to a preset.
- The item approval names the counterpart, exact topics and previewed preset versions, lasts ≤ 24 h and is revocable. It is rechecked at commit and at every acceptance.

**Venue tags:** not added (see the matrix's venue review). No habitual-visit disclosure is possible from the shipped fields.

**Rejection cases consumers must keep:** third-account plan action; wrong revision; repeat accept; one-sided acceptance at expiry; second acceptance after intent revoke, re-publish, approval revoke, preset tightening, block, event cancellation, moved start or stale copy; commit with a non-participant's intent, a stale intent version, an unaccepted basis, approvals on an introduction basis, < 1 h lead or a duplicate live plan; user-written catalogue records; unsafe source links; free topics; intent for a cancelled, stale or started event.

## 2026-10-24: CS PR #30 index rewrite, post-merge boundary review (Cyber)
Verdict: **ACK, no leak found; no fix needed.** #30 moved per-user views and hot reducers from whole-table scans to btree index ranges and added `pair_member`. Checked against the pre-#30 code:
- **Caller filters unchanged in meaning.** Each per-user view now reads only the caller's index range, which is the same set the old `iter().filter(caller)` produced:
  - `my_pairs` (via `pair_member`), `my_invites`, `my_presets` and `my_preset_assignments` read the caller's owner/creator range;
  - `my_nudges` reads the recipient range;
  - `my_signals` and `my_receipts` read the sender range;
  - `my_support_preferences` and `my_nudge_delivery` read the recipient range;
  - `my_introductions` reads the sender and recipient ranges; `my_introduction_proposals` reads the viewer range;
  - `my_event_intents` and `my_activity_approvals` read the owner range; `my_plans` reads both participant ranges.

  Reducers (`approve_signal` idempotency, `revoke_signal`, `suppressPairWork`, delivery, preferences, presets, introductions, events) look up by caller or pair index with the same predicates.
- **`pair_member` consistency.**
  - Invite writes the creator's row and accept writes the accepter's, in the same transaction as the `pair` update. Self-accept is still refused, so the `pair:member` key can't collide.
  - Unlink keeps both rows, and `pair.status` stays authoritative everywhere (`alreadyPaired` skips unlinked pairs; `requireMemberPair` still reads `pair`). A re-pair gets a new pair id and new rows.
  - No view exposes `pair_member`.
- **Nothing new visible to a third account.** The only new public view is `catalogue_status` (feed key, times, status, count): operational metadata, no user data, registered accounts only, flag-gated. `record_catalogue_run` is ingester-only.
- **Evidence:** existing third-account suites pass. Mutations against #30's filters (`pairsOf` reading all members, `my_plans` reading one participant side, accept not writing `pair_member`) are each caught by the suite.
- **Operational note:** `pair_member` has no backfill. If a module with existing pairs were republished, those pairs would vanish from `my_pairs`. That fails closed, not a leak; irrelevant today because nothing is published.

## 2026-10-24: D040 private assessment (Adam), Cyber boundary review
Verdict: **ACK with conditions.** Checked against `docs/features/PRIVATE_ASSESSMENT.md` §1/§3/§4 and the code (`src/agents/src/reflection/claude.ts`, `src/features/voice/{assessment,model}.ts`, `voice-reflection.tsx`, `decision-loop.tsx`, `src/app/journal/page.tsx`, `src/app/api/reflections/route.ts`):
- **Owner-only and in memory: holds.** `splitReflection` persists only the reflection text; the candidate and assessment stay in component state. The journal clears the episode on `pagehide`, and the editor unmounts on lock.
- **Never sent onward: holds.** The assessment returns to the owner's browser only. Nothing writes it to SpacetimeDB, approved signals, Factory/Droid, analytics or logs. The route's usage log is token counts, duration and outcome only.
- **Narrow-only: holds.**
  - `wants_space` and invalid assessments stop.
  - `wants_connection` only skips the company question.
  - Excluded names remove matches, and ambiguous names remove all matches. Preferred names only reorder.
  - Name matching runs on the device; Claude never receives the contact list.
  - `decide()` can't reach a preview without the owner choosing the person, and `ShareReview` approval stays separate.

Conditions:
1. An assessment, exclusion or clarification answer must never create, extend or lift a D041 pause. The UI may *offer* a pause; only the owner's tap sets it.
2. The `ShareReview` preview and approval stay mandatory on every path, including `wants_connection`.
3. The "Leaving out X for now" line is owner-screen copy only, never a notification or any recipient-visible text.
4. DS evals include the ambiguous-name and injection cases from §5.

## 2026-10-25: live-host fix for database-initiated calls (CS Core 3 finding)
- **Finding (CS, live):** `sweep_expired` refused every scheduled run with `unauthorized: scheduler only`. SpacetimeDB 2.13 never sets `senderAuth.isInternal` on a real host; `AuthCtxImpl.fromBackend` always sets it to false, and only the in-process harness sets it. Expiry markers were therefore never written live, so lapsed records (including D041 pauses) stayed in force in views. That failed closed, but it was broken.
- **Fix:** new `isDatabaseInternal(ctx)` in `guards.ts` requires no connection AND `ctx.sender` equal to `ctx.databaseIdentity` (the harness keeps `isInternal`). A client can't satisfy both: every client call has a connection, and client identities come from their token's issuer and subject.
- **Applied to:**
  - `sweep_expired`: the bug.
  - `requireIngester`: the module owner was refused live, because the owner was only ever admitted through `isInternal`. The owner is now checked against the owner row, and the database itself is admitted.
  - `requireOwner`'s no-owner-row fallback: never reached live; kept fail-closed.
  - `requireAuthenticated`'s `isInternal` shortcut is harness-only. No scheduled reducer calls it, so it's unchanged and commented.
- **Evidence:** `spacetimedb/tests/scheduler_auth.test.ts` (5) calls the reducers with a live-shaped context (`isInternal` false, no connection, database identity). The sweep runs and really ends a lapsed pause. A user, the database identity with a connection, and a stranger without a connection are each refused for the sweep and for ingestion; the owner can ingest. 5 of 5 mutations are caught, including reverting to `isInternal`. Not yet re-verified on the live host: CS should restart the local module and confirm the sweep log is clean.

## 2026-10-25: Core 3 audit items 2 and 3 fixed (D043; numbered after AI's D042)
- **Item 2 (HIGH, timing to the recipient):** `my_nudges` now returns `{id, pair_id, template_id, visible_until}`, with `visible_until` rounded up to the hour. Tests: exact row keys; no signal or consent ids; an hour-aligned `visible_until` within one hour after the exact expiry. A mutation restoring the exact expiry is caught.
- **Item 3 (HIGH, recipient state to the sender):** `my_receipts` filters to `approved` and `revoked`. Owner-caused invalidation is recorded as `revoked`. Noninterference test: recipient opt-out, consent revoke and unlink leave the sender's receipts byte-identical. 3 mutations caught.
- **Residual:** nudge arrival time for a live subscriber (see D043).

## 2026-10-25: DS forbidden-disclosure labels vs D041/D043 (asked by DS since the 18:45Z handoff)
Verdict: **ACK the six labels, with three additions recommended.** The six (`unapproved_recipient`, `private_activity`, `location`, `excuse`, `relationship_tension`, `timing_detail`) cover *content*: what words appear on a screen or in recipient copy. D041 and D043 add disclosure through *structure*, which those labels don't name:
1. **`restriction_signal`:** anything recipient-visible that reveals an exclusion or pause exists, such as a badge, status, receipt, a count change, or a nudge vanishing at a telling moment. D041 keeps the server silent; this label lets DS check the client and copy too. (`relationship_tension` covers *wording* like "they avoided you", not structural tells.)
2. **`approval_timing`:** the sender's approval or journaling moment reaching the recipient. This was the D043 leak. DS's own timing todo tests it against its row model; keep it separate from `timing_detail`, which means story timing ("Friday night").
3. **`recipient_state`:** the recipient's opt-in, quiet hours, cooldown, accepted modes or consent changes reaching the sender. This was the D043 receipts leak.

The pause cases pz1–pz4 are correct: never offered, only-candidate → no_action, picked anyway → no_recipient, expired → offered again in a new episode, plus pause noninterference.

**Still missing:** a **change of mind mid-episode** case. The owner is at the preview step with Alex chosen when a pause on Alex becomes active. Expected: the loop does not proceed to approval (or approval is refused, `unauthorized: recipient_paused`), and nothing reaches Alex. The server side (a pause between approval and commit) is covered by `spacetimedb/tests/pause.test.ts` and Adam's worker cases.

## 2026-10-25: a3 status (semantic signal IDs) → proposed D047 (was D044)
On the real path a3 is mitigated twice: the module mints UUID v4 ids, and D043 removed source signal ids from the recipient's nudge row. The remaining gap is the shared contract, the fake and `DisclosurePolicy` accepting readable ids. `isServerMintedId` is added (unused, with tests). Enforcement needs DS and AI to migrate their fixtures, so it waits for their ACK (D047).

## 2026-10-25: Core 4 privacy review (Cyber): recipient surfaces, copy, controls, account switch
Verdict: **PASS with two copy fixes owed (MEDIUM, owners' files).** Offline code review of main `53795c2`; not a browser or live check.

**1. Recipient-visible surfaces: pass.**
- The core views a recipient subscribes to carry nothing from the sender:
  - `my_pairs` holds counterpart name, status and created time only;
  - `my_nudges` is the D043 narrow row;
  - everything else is the caller's own data.
- No nudge count badge, no push or notifications (the service worker says so, and `sw-register` registers static assets only). Nudge copy is the fixed contract template, and `visible_until` isn't rendered.
- Pause UI reads only the owner's `my_recipient_pauses`; the paused person has no surface.
- Known residuals (documented): an already-seen nudge disappears on pause or revoke, and live arrival time tracks the commit (D043).

**2. Privacy copy: two fixes.**
- **F1 (MEDIUM, AI: `src/features/voice/voice-reflection.tsx` ~227):** "only the text you selected is sent **transiently** to Claude" implies no retention, but `src/agents/src/disclosure.ts` records Claude retention as `unverified`. AGENTS.md forbids retention claims without a verified design. Suggested: "…is sent to Claude (Anthropic) to write it, under their data policy." Drop "transiently" for Cartesia too, whose zero retention is enterprise-only.
- **F2 (MEDIUM, CS: `src/components/feature/pause-controls.tsx` / `pause-model.ts` `PAUSE_PROMISE`):** the pause shows only "They are not notified." The D041 copy rule (`src/privacy/README.md`) also requires: "Anything you've already shared with {name} is withdrawn now. If they already saw a nudge, it will disappear." Without that, the owner isn't told the one visible effect.
- **Honest and accurate:**
  - the vault ("Encrypted at rest in this browser. It is not end-to-end encrypted processing…");
  - privacy facts ("not a mathematical privacy guarantee or end-to-end encrypted inference"; "A nudge may let someone infer…");
  - delete ("cannot be undone… Shared approvals are managed separately");
  - discovery ("exact location is never sent or stored");
  - suggestions ("Only you see these").

**3. Controls: pass.**
- Delete vs revoke: delete crypto-shreds the local vault only, and says shared approvals are separate. Per-item revoke lives in Privacy (`ApprovedSignals`). Both behave as worded.
- Expiry: the live sweep is fixed (#34; CS live sweep 30/30). Pause expiry goes through the sweep; reducers use the real clock.

**4. Account switch and sign-out: pass.**
- `useSharedController` disposes the SpacetimeDB controller on user change (clears cached rows, closes the socket).
- `useAccountVault` aborts, which locks the previous vault.
- `<Fragment key={userId}>` remounts the whole tree, so the journal episode, decision loop, share review and form state are dropped.
- `pagehide` clears the episode.
- No `localStorage`, `sessionStorage` or cookies hold data. The service worker caches `/_next/static` only. The Clerk token stays in memory via `getToken`.
- Residual (LOW, by design): each account's encrypted vault DB stays on disk under a hashed name, so a shared browser shows that *some* account used it. Contents stay encrypted.

**Not covered (needs live/browser):** real-browser rendering, IndexedDB contents on disk, phone/PWA, live network trace. Those are Core 3/R5 items.

## 2026-10-25: D028 review of CS Apify ingestion (`src/lib/catalogue/*`, `scripts/ingest-catalogue.ts`), README D045 Phase 1
Verdict: **ACK with two conditions.**
- **Holds:**
  - Every request is built by `feedQueries` → `guardPublicCatalogueQuery`, and the POST body is only `{searchTerms: [allowlisted topic], maxItems, language}`.
  - The token travels in an `authorization` header and is never printed; errors carry only the HTTP status.
  - Records pass the same `guardCatalogueEvent` the module runs, and instruction-like titles are dropped.
  - Topics come from the query, never scraped text. Event ids are stable source-scoped hashes.
  - Commits use `execFileSync` argument arrays (no shell).
  - Single-flight lock and a 6 h refresh window.
- **Condition 1:** the regional source lives in the Apify *task's* saved input (`APIFY_TASK_ID`), outside the repo, so it can't be reviewed. Record the Actor id, pinned build and region/search string (non-secret) in `feeds.ts` or `docs/RUNBOOK.md`, and pin the build.
- **Condition 2:** confirm the task input holds only a developer-chosen public region and source, with no personal or test-account data. README D045 Phase 1 compares a Luma and a Meetup Actor; whichever is chosen, its hosts must be in `SOURCE_HOSTS` and in the module's `source_hosts` config, and its field map must stay the minimal `title/startDate/endDate/url/isCancelled`.

## 2026-10-25: D045 Phase 4 adversarial and boundary audit (Cyber)
Verdict: **no release-blocking finding.** Offline evidence only.
- **New corpus** `src/privacy/__tests__/adversarial.test.ts` (5 groups) runs against the real guards and CS's real `normalizeItem` (imported read-only):
  1. **18 SSRF and lookalike URLs** (http, javascript:, data:, file:, loopback, link-local metadata, IPv6, credentials, ports, `lu.ma.evil.com`, `evil.com/lu.ma`, `lu.ma@evil.com`, punycode, scheme-relative) never become a source URL.
  2. **Oversized and malformed records:** titles are capped at 120; non-string, empty, unparseable, past or beyond-horizon records are dropped; venue, organizer, attendee and coordinate fields never survive.
  3. **Prompt-injection titles** are dropped at ingestion, and bidi, zero-width and markup are stripped.
  4. **Profile stuffing:** extra fields (including a JSON `__proto__` key) are refused; emails (also full-width look-alikes, caught after NFKC), phones, handles, domains, UUIDs, bidi or zero-width and over-length names are refused; a sensitive tag is refused even in a draft (D046).
  5. **Apify queries** refuse location, user ids, free text, identifiers, oversized limits and sensitive topics.
- **Already covered elsewhere:** third-account access, rate-limit exhaustion, expiry and revocation races, and replay (D038/D039/D041/D043 suites, `newcomer_journey`, `consent_independence`).
- **Output projection:** discovery cards have exactly 5 fields, nudges 4, receipts are sender-own.
- **Logging:** worker and reflection-route logs are metadata only (event, codes, counts, durations, an 8-character identity prefix). LOW note: worker `fatal` keeps up to 80 characters of an error message; today those are codes. Keep it that way.
