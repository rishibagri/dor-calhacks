# src/privacy — disclosure policy, guards and reviews (Cyber)

One policy implementation lives in the shared package (AGENTS.md: cross-boundary imports only via `@kinetic/contracts`). CS's device preview, the SpacetimeDB reducers/views, routes and the worker all call it (D026).

| Import | Contents | Runtime deps | Use in |
|---|---|---|---|
| `@kinetic/contracts/policy` | Core semantics:<br>• `evaluateDisclosure` (F3 core)<br>• `guardApproval` (F4)<br>• `guardSignalUse` / `guardSignalStanding` (each use, views)<br>• `guardNudgeCommit` (F7, including the F5 gate)<br>• `nudgeDelivery`, `validRecipientDelivery`, `templateForSignal`, `sameApprovedPayload`, `payloadRevision`, `policyErrorCode`<br>• constants and enums | none | SpacetimeDB module (authoritative) |
| `@kinetic/contracts` | All of the above, plus:<br>• `previewDisclosure` + copy (device F3)<br>• `DisclosurePolicy` (real `DisclosurePolicyPort`)<br>• `guardPublicCatalogueQuery` / `safeCatalogueUrl` (proposed C7 boundary) | Zod | UI, routes, worker |
| `@kinetic/contracts/fakes` | `FakeDisclosurePolicy` | — | offline tests only |

Docs in this folder: [REVIEWS.md](REVIEWS.md) (D016–D021 verdicts), [ACTIVITY_CONSENT.md](ACTIVITY_CONSENT.md) (C7/Apify boundary). The vault lives in `src/vault/` ([DESIGN.md](../vault/DESIGN.md)).

## Rules every caller must follow
1. Guards decide; they never authenticate. Reducers pass `ctx.sender` only after `requireAccount` (users) or `requireWorker` (worker). Never pass an ID taken from args, JWT custom claims or a model.
2. Build snapshots from authoritative tables **in the same transaction** as the write (`spacetimedb/src/policy_state.ts`). Recipient, policy id and expiry come from the decision.
3. `nowMs` comes from `ctx.timestamp`. Views have no clock, so they use `guardSignalStanding` only. Expiry is enforced at use and commit time; a scheduled sweep is still open.
4. On deny: `fail(policyErrorCode(reason), reason)`. The message carries only the reason code.
5. Quiz answers, profile, extras, model/coordinator output, `AgentAck` and `CoordinationOutcome` never grant anything.

## Semantics (FLOWS.md F3–F8)
- **Effective disclosure** = accepted pair ∩ preset assigned to this named recipient (ids match) ∩ preset unrevoked/unexpired ∩ allowed categories ∩ exact previewed payload ∩ current preset and assignment versions ∩ `DISCLOSURE_CONSENT_VERSION` ∩ `payloadRevision`.
- **Preview omits blocked fields.** An approval still carrying a blocked field is **denied** (`blocked_category`), never stripped. `no_preference` is never substituted.
- **Any preset or assignment version change** (including broadening) stales older approvals.
- **Expiry** is min(now + 24h, preset expiry). An approval replay with the same `client_request_id` is a no-op even after revoke.
- **F5:** no `nudge_delivery` row means not opted in (D017). Quiet hours use the recipient's local offset (D018). Cooldown is 24h per pair and counts every nudge.
- **F7:** every source passes `guardSignalUse` at commit, and the template must be `templateForSignal` of an approved source (availability-only gives no nudge). An F5 recheck follows. A replay with the same `nudge_id` is a no-op and never resurrects a suppressed nudge.
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
1. Ops: publish, then `spacetime call kinetic set_worker_identity '<worker identity hex>' true` as the module owner. The worker connects with its own SpacetimeDB token and never registers an account.
2. The worker reads `worker_signal_context`, which lists only signals that currently have standing, plus snapshot metadata. Map each row into `PolicyStateReader.load()`:
   - `signal`: `StoredSignal` from the signal columns (`expiresAtMs = expires_at` in ms, `revokedAtMs: null`)
   - `snapshot.pair`: `{pairId, memberA: pair_member_a hex, memberB: pair_member_b hex|null, status: pair_status}`
   - `snapshot.assignment`: `{ownerId: sender hex, recipientId: assignment_recipient hex, pairId, presetId: assignment_preset_id, assignmentVersion: assignment_version}` (null if missing)
   - `snapshot.preset`: `{policyId: assignment_preset_id, ownerId: sender hex, allowedCategories: preset_allowed_categories, version: preset_version, expiresAtMs, revokedAtMs: preset_revoked ? 0 : null}`
3. Use `new DisclosurePolicy(reader, clock)` in place of `FakeDisclosurePolicy`. `worker_delivery` backs `DeliveryStatePort`.
4. Commit with `commit_nudge({nudge_id, pair_id, template_id, source_signal_ids, source_consent_versions})`. Errors are sanitized codes, so map them to `CoordinationOutcome` and **never show them to the sender** (REVIEWS.md D021 #5).

### CS: Apify (C7)
Build every Actor input via `guardPublicCatalogueQuery(input, ACTIVITY_TOPIC_ALLOWLIST)`, and render source links only via `safeCatalogueUrl`. See ACTIVITY_CONSENT.md.

## Known gaps (2026-10-24)
- Nothing is published. All reducer and view evidence comes from the in-process SpacetimeDB harness, which doesn't prove deployed isolation, real JWT mapping or concurrent transactions.
- There's no recipient support-preferences consent table yet (D021 #4), so live coordination must stay fail-closed.
- There's no scheduled expiry sweep, so views show expired rows until use or commit rejects them.
- JWT `aud` isn't checked, and there's no rate limiting on `approve_signal` / `set_nudge_delivery`.
- C7 activity sharing isn't permitted; only the Apify input and link guards exist.
