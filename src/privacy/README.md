# src/privacy — disclosure policy, guards and reviews (Cyber)

One policy implementation lives in the shared package (AGENTS.md: cross-boundary imports only via `@dor/contracts`). CS's device preview, the SpacetimeDB reducers/views, routes and the worker all call it (D026).

| Import | Contents | Runtime deps | Use in |
|---|---|---|---|
| `@dor/contracts/policy` | Core semantics:<br>• `evaluateDisclosure` (F3 core)<br>• `guardApproval` (F4)<br>• `guardSignalUse` / `guardSignalStanding` (each use, views)<br>• `guardNudgeCommit` (F7: sources, recipient preference consent, F5 gate)<br>• `guardPreferenceStanding`, `validSupportPreferences` (C4 recipient consent, D035)<br>• `audienceAllowed` (JWT `aud`, D035)<br>• proposed C8: `guardPublicationDraft`, `guardAreaKey`, `guardDiscoveryVisibility`, `projectDiscoveryCard`, `discoveryErrorCode`<br>• `nudgeDelivery`, `validRecipientDelivery`, `templateForSignal`, `matchesPreviewPayload`, `payloadRevision`, `policyErrorCode`<br>• constants and enums | none | SpacetimeDB module (authoritative) |
| `@dor/contracts` | All of the above, plus:<br>• `previewDisclosure` + copy (device F3)<br>• `DisclosurePolicy` (real `DisclosurePolicyPort`) + `sameApprovedPayload` (presented vs stored envelope)<br>• `guardPublicCatalogueQuery` / `safeCatalogueUrl` (proposed C7 boundary) | Zod | UI, routes, worker |
| `@dor/contracts/fakes` | `FakeDisclosurePolicy` | — | offline tests only |

Docs in this folder: [REVIEWS.md](REVIEWS.md) (D016–D021 verdicts, C8 review), [ACTIVITY_CONSENT.md](ACTIVITY_CONSENT.md) (C7/Apify boundary). The vault lives in `src/vault/` ([DESIGN.md](../vault/DESIGN.md)); its UI controls in `src/features/privacy/` ([README](../features/privacy/README.md)).

## Rules every caller must follow
1. Guards decide; they never authenticate. Reducers pass `ctx.sender` only after `requireAccount` (users) or `requireWorker` (worker). Never pass an ID taken from args, JWT custom claims or a model.
2. Build snapshots from authoritative tables **in the same transaction** as the write (`spacetimedb/src/policy_state.ts`). Recipient, policy id and expiry come from the decision.
3. `nowMs` comes from `ctx.timestamp`. Views have no clock, so they use the standing guards plus `expired_record` markers written by the scheduled `sweep_expired` reducer (every 60 s). Reducers that use a record still check expiry against their own clock.
4. On deny: `fail(policyErrorCode(reason), reason)`. The message carries only the reason code.
5. Quiz answers, profile, extras, model/coordinator output, `AgentAck` and `CoordinationOutcome` never grant anything.

## Semantics (FLOWS.md F3–F8)
- **Effective disclosure** = accepted pair ∩ preset assigned to this named recipient (ids match) ∩ preset unrevoked/unexpired ∩ allowed categories ∩ exact previewed payload ∩ current preset and assignment versions ∩ `DISCLOSURE_CONSENT_VERSION` ∩ `payloadRevision`.
- **Preview omits blocked fields.** An approval still carrying a blocked field is **denied** (`blocked_category`), never stripped. `no_preference` is never substituted.
- **Any preset or assignment version change** (including broadening) stales older approvals.
- **Expiry** is min(now + 24h, preset expiry). An approval replay with the same `client_request_id` is a no-op even after revoke.
- **F5:** no `nudge_delivery` row means not opted in (D017). Quiet hours use the recipient's local offset (D018). Cooldown is 24h per pair and counts every nudge.
- **F7:** every source passes `guardSignalUse` at commit, and the template must be `templateForSignal` of an approved source (availability-only gives no nudge). Then the recipient's **current** preference consent must match the bound `recipient_consent_id/version`, be unrevoked and unexpired, and include the template's mode. An F5 recheck follows. Nudge expiry = min(sources, consent, now + 24h). A replay with the same `nudge_id` and the same binding is a no-op and never resurrects; a different binding is `invalid: nudge_id reused`.
- **Recipient preference consent (C4, D035):** recipient-owned `support_preference` row per pair, written only via `set_support_preferences` / `revoke_support_preferences` (caller = recipient, accepted pair, expiry ≤ 30 days, optimistic `expected_version`). Every change bumps `consent_version`. Revoke suppresses pending nudges, and `my_nudges` hides any nudge whose bound consent was revoked, expired, replaced by a different record, or no longer covers its mode. Never visible to the sender.
- **Expiry and snooze in views:** `sweep_expired` (internal only) suppresses expired nudges, clears snoozes that have ended, and marks expired signals, preferences, publications and areas. `my_nudges` hides snoozed nudges. Stale window ≤ one sweep interval.
- **JWT audience:** every reducer caller's token must carry an allow-listed `aud` (`auth_audience`, owner-managed); empty allowlist = nobody.
- **Reason → error code:**

  | Reason | Error code |
  |---|---|
  | `invalid_schema`, `unlinked` | `invalid` |
  | `wrong_recipient` | `not_found` |
  | `no_consent`, `blocked_category`, `not_opted_in` | `unauthorized` |
  | `expired`, `revoked`, `stale_policy` | `stale` |
  | `quiet_hours`, `cooldown` | `rate_limited` |

## Integration instructions
### CS: device preview → approve (F3/F4)
1. Run `previewDisclosure({candidate, ownerId, recipientId, pairId, pairStatus, preset, assignment, now}, recipientName)` on the device, building the inputs from `my_pairs`, `my_preset_assignments` and `my_presets`. No network call.
2. On `shareable`, send exactly `payload` to `approve_signal` with:
   - `payload_revision = payloadRevision({pairId, recipientId: counterpartHex, ...payload, recipientPolicyVersion, presetAssignmentVersion, consentVersion: DISCLOSURE_CONSENT_VERSION})`
   - the same versions
   - a fresh `client_request_id` per preview, reused only for retries of that approval
3. Privacy center: `my_signals` (sender-only, with revoke) and `my_receipts` (sender-only: approved/used/revoked/suppressed).

### CS: recipient settings (F5)
- `set_nudge_delivery({pair_id, opted_in, quiet_start_minute?, quiet_end_minute?, utc_offset_minutes})`. Read it back via `my_nudge_delivery`.
- Default UI state is **off**. Capture `utc_offset_minutes` as the negation of `new Date().getTimezoneOffset()`.

### CS + Adam: worker (F6/F7)
1. Ops: publish, then `spacetime call dor set_worker_identity '<worker identity hex>' true` as the module owner. The worker connects with its own SpacetimeDB token and never registers an account.
2. The worker reads `worker_signal_context`, which lists only signals that currently have standing, plus snapshot metadata. Map each row into `PolicyStateReader.load()`:
   - `signal`: `StoredSignal` from the signal columns (`expiresAtMs = expires_at` in ms, `revokedAtMs: null`)
   - `snapshot.pair`: `{pairId, memberA: pair_member_a hex, memberB: pair_member_b hex|null, status: pair_status}`
   - `snapshot.assignment`: `{ownerId: sender hex, recipientId: assignment_recipient hex, pairId, presetId: assignment_preset_id, assignmentVersion: assignment_version}` (null if missing)
   - `snapshot.preset`: `{policyId: assignment_preset_id, ownerId: sender hex, allowedCategories: preset_allowed_categories, version: preset_version, expiresAtMs, revokedAtMs: preset_revoked ? 0 : null}`
3. Use `new DisclosurePolicy(reader, clock)` in place of `FakeDisclosurePolicy`. `worker_delivery` backs `DeliveryStatePort`.
4. `worker_support_preferences` backs `RecipientPreferencesPort`. Map each row to `RecipientSupportPreferences`: `{schemaVersion: 1, consentId: consent_id, consentVersion: consent_version, pairId: pair_id, recipientId: recipient hex, purpose: 'support_nudge', supportModes: support_modes, availability, expiresAt: ISO(expires_at), revokedAt: null}`. No row means `preferences_unavailable`.
5. Commit with `commit_nudge({nudge_id, pair_id, template_id, source_signal_ids, source_consent_versions, recipient_consent_id: ack.recipientConsentId, recipient_consent_version: ack.recipientConsentVersion})`. Errors are sanitized codes, so map them to `CoordinationOutcome` and **never show them to the sender** (REVIEWS.md D021 #5).

### CS: recipient preference settings (C4, D035)
- `set_support_preferences({pair_id, support_modes, availability, expires_at, expected_version})`, `revoke_support_preferences({pair_id})`. Read back via `my_support_preferences`. Default UI state: no consent (no row). Show the expiry; offer renew and revoke.

### Ops (CS): auth and sweep
1. Clerk JWT template (`NEXT_PUBLIC_CLERK_SPACETIME_JWT_TEMPLATE`): set a fixed `aud` claim, e.g. `"aud": "dor-spacetimedb"`.
2. After publish, as module owner: `spacetime call dor set_auth_issuer '"<clerk issuer>"' true` **and** `spacetime call dor set_auth_audience '"dor-spacetimedb"' true`. Without an audience, every user reducer fails `unauthenticated`.
3. `init` schedules `sweep_expired` every 60 s. Confirm one `expiry_sweep` row exists after publish.

### CS: discovery (proposed C8, off by default)
Owner config: `set_discovery_config({key:'tags', values:[...]})`, `{key:'areas', values:[...]}` (configured coarse areas only), then `{key:'enabled', values:['true']}` only after the C8 ACKs. Client: `publish_discovery_profile`, `set_discovery_area` (the device maps its one-time sample to a configured area key and discards it), `withdraw_discovery_profile`, `block_discovery_user({card_ref})`. Subscribe to `discovery_cards` and `my_discovery_profile`. See REVIEWS.md "C8".

### CS: introductions, block and report (proposed C8, D038)
Client: `send_introduction_request({card_ref, client_request_id})` (a fresh random id per user tap, reused on retry), `respond_introduction_request({intro_id, accept})`, `cancel_introduction_request`, `block_introduction_participant`, `report_discovery_user({target_kind, target_ref, reason})`, `dismiss_introduction_proposal`. Subscribe to `my_introductions` and `my_introduction_proposals`. Compose `<IntroductionControls>` (`src/features/privacy/README.md`). Never show a decline to the sender, and show refusals only through `messageForError`. Full matrix: `DISCOVERY_ENFORCEMENT.md`.

### Adam: introduction proposals (D033 → D038)
Commit each proposal with the worker identity through `commit_introduction_proposal({proposal_id, viewer_ref, candidate_ref, viewer_publication_version, candidate_publication_version, reason_code: 'shared_interest', shared_tags, event_id: none, opener_id: 'suggest_shared_interest', decided_by, expires_at})`. `proposal_id` must match `^[A-Za-z0-9_-]{8,64}$` (a UUID qualifies). The reducer is the authority: treat `stale:*`, `not_found:*`, `unauthorized: withdrawn` and `invalid:*` as no proposal, and `unauthorized: worker only` as a deployment fault. `same_event` is refused until R3.

### CS: recipient pause controls (D041, core)
- **Reducers:** `pause_recipient({pair_id, expires_at, expected_version})` and `resume_recipient({pair_id, expected_version})`. `expected_version` is the row's `version` from `my_recipient_pauses` (0 for none). Join `pair_id` to `my_pairs` to show the name. Show `expires_at`, offer resume, and never ask for a reason.
- **Copy rule:** "{name} isn't notified." Also say that anything already shared with them is withdrawn now, and that a nudge they already saw will disappear.
- **The assessment and clarification answers may *offer* a pause, never set one** (D040 review condition 1).
- **`approve_signal` refuses with `unauthorized: recipient_paused`.** Show "Sharing with {name} is paused until {time}."
- **Bindings:** regenerate them for the new reducers and view.

### CS: events, intents and plans (C7/C8, D039)
Ingestion (server only): after the D028-guarded Apify run, call `upsert_catalogue_event` as the module owner or the allow-listed worker, once per normalized record. Set `set_discovery_config({key:'source_hosts', values:[...]})` first. Client: `catalogue_events` (filter by your own area on the device), `publish_event_intent` / `revoke_event_intent` with `my_event_intents` for the version, `event_companions` for mutual overlap, `respond_plan({plan_id, revision, accept})` / `cancel_plan` with `my_plans`. Existing pairs: a preset toggle for `activity_interest` (off by default, owner-confirmed) plus `approve_activity_interest` / `revoke_activity_interest` with `my_activity_approvals`. Use the preview strings in `src/features/privacy/event-consent-model.ts` verbatim and compose `<EventPrivacyControls>`.

### Adam: shared plans (D034 → D039)
Read `worker_plan_candidates` (worker identity). For each row, `commit_plan_proposal({plan_id, basis_kind, basis_ref, event_id, intent_ids, intent_versions, approval_ids, expires_at, decided_by})` with the row's ids and versions unchanged; `plan_id` must match `^[A-Za-z0-9_-]{8,64}$`. The reducer sets times from the catalogue. After a catalogue change, `revise_plan_proposal({plan_id, expected_revision, expires_at})`. Treat `stale:*`, `not_found:*` and `invalid:*` as no plan, and `unauthorized: worker only` as a deployment fault. `PlanCoordinator`'s options must come from these rows only.

### CS: Apify (C7)
Build every Actor input via `guardPublicCatalogueQuery(input, ACTIVITY_TOPIC_ALLOWLIST)`, and render source links only via `safeCatalogueUrl`. See ACTIVITY_CONSENT.md.

## Known gaps (2026-10-24, Core 2)
- **D041 pause is offline only.**
  - In clockless views, a lapsed pause stays "in force" until the next 60 s sweep. That fails closed.
  - A nudge the counterpart already saw disappears on pause, the same as any revoke. That's an unavoidable inference, stated in the owner copy.
  - `my_recipient_pauses` still lists a pause for a pair that was later unlinked. It's harmless (the unlinked pair can't share), and CS can hide it using `my_pairs` status.
- Nothing is published. All reducer and view evidence comes from the in-process SpacetimeDB harness, which doesn't prove deployed isolation, real JWT mapping, the real scheduler or concurrent transactions.
- **Views can't check `aud`** (ViewCtx has no `senderAuth`). A token from the same Clerk instance minted for another audience maps to the same Identity and could read that user's own `my_*` rows; reducers refuse it. Mitigation: use a Clerk instance (distinct issuer) dedicated to dor, since a separate JWT template keeps the same iss/sub.
- Expiry in views is bounded by the 60 s sweep, not exact. The sweep scans whole tables (fine for the demo; index it in R4). `expired_record` markers are never pruned.
- Discovery reducers have per-caller daily limits (D038). `approve_signal`, `set_nudge_delivery` and `set_support_preferences` still have none (R4). Limits are per database and count successful actions only.
- C8 is proposed: publication, area, introductions, block, report and limits are implemented offline (D038, `DISCOVERY_ENFORCEMENT.md`). Discovery stays disabled until the C8 ACKs. Events, intents, C7 approvals and plans are implemented offline (D039); no live Apify source yet; `same_event` introduction proposals still refused (needs an AI shape change); no moderator tooling.
- C7 activity sharing isn't permitted; only the Apify input and link guards exist.
