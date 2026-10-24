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

**Open for R2 (not implemented):** introduction proposal/request/accept (human-triggered; recipient alone accepts), report with a coarse reason, invite and repeat-probe limits, avatar media path, event intent (C7/C8). Exact area resolution, publication duration and audience defaults still need owner confirmation; the current numbers are the LOCAL_CONNECTIONS proposals.

**Review checklist assigned:** CS: UI copy for audience and duration, the device-side coarsening to a configured area, the flag rollout. DS: rank only `discovery_cards` rows (published tags), never private extras. AI: agent prompts get tags and opaque refs only; recheck visibility at commit.
