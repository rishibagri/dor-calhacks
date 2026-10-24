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
