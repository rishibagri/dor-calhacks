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
4. **`RecipientSupportPreferences`: BOUNDARY GAP (blocking for live coordination).**
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
