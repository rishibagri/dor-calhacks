# src/privacy — disclosure guards (Cyber)

The production guards live in the shared package so every boundary runs **one** implementation, as AGENTS.md requires (cross-boundary imports only via `@kinetic/contracts`):

| Import | Contents | Runtime deps | Use in |
|---|---|---|---|
| `@kinetic/contracts/policy` | `guardApproval`, `guardSignalUse`, `guardSignalStanding`, `guardNudgeCommit`, `payloadRevision`, `policyErrorCode`, `categoriesOf`, constants, enum arrays | none (no Zod, no clock, no I/O) | SpacetimeDB reducers/views (authoritative) |
| `@kinetic/contracts` | All of the above plus `DisclosurePolicy` (`DisclosurePolicyPort`) and `sameApprovedPayload` | Zod | Next.js routes, worker (defence in depth) |
| `@kinetic/contracts/fakes` | `FakeDisclosurePolicy` | — | Offline tests only, never live |

Source: `contracts/src/policy.ts`, `contracts/src/policy-port.ts`. Tests: `contracts/tests/policy.test.mjs` (pure) and `spacetimedb/tests/disclosure.test.ts` (direct reducer calls in the SpacetimeDB harness).

## Rules every caller must follow
1. Guards decide; they never authenticate. Pass `callerId = ctx.sender` (hex) only after `requireAccount(ctx)`. Never pass an ID from args, JWT custom claims or a model.
2. Build snapshots from authoritative tables **in the same transaction** as the write (`spacetimedb/src/policy_state.ts: loadStanding`). Recipient, policy id and expiry come from the decision, never from args.
3. `nowMs` comes from `ctx.timestamp`. Views have no clock, so they may only use `guardSignalStanding`; expiry needs a scheduled sweep (open item).
4. On deny: `fail(policyErrorCode(d.reason), d.reason)`. The message is only the reason code, never payload values.
5. Quiz answers, `LocalConnectionProfile`, `LocalQuizExtras`, model or coordinator output and AgentAck are never guard inputs that can grant anything.

## Semantics
- **Effective disclosure** = caller is a member of an `accepted` pair ∩ the caller's assignment names the other member ∩ the assigned preset is the caller's, unrevoked, unexpired, at the bound version ∩ every disclosed category is allowed ∩ `consentVersion === DISCLOSURE_CONSENT_VERSION` ∩ `payloadRevision` matches the exact preview.
- **Blocked category** denies the whole request. No stripping and no `no_preference` substitution.
- **Any preset or assignment version change** makes older signals and previews stale, including broadening; old data is never re-shared.
- **`payloadRevision`** is FNV-1a 32 over the canonical preview payload. It is integrity against stale or drifted previews, not an anti-forgery MAC; the authenticated owner is the authority.
- **Expiry** is `min(now + 24h, preset.expiresAt)`, computed server-side.
- **Idempotency**: `client_request_id` is scoped to the sender. A replay with an identical payload is a no-op, even after revoke, so a revoked signal is never resurrected. Reuse with a different payload is rejected as `invalid`.
- **Reason codes and their errors**: `invalid_schema`→`invalid`, `wrong_recipient`→`not_found` (non-members can't probe), `no_consent`/`blocked_category`→`unauthorized`, `unlinked`→`invalid`, `expired`/`revoked`/`stale_policy`→`stale`.

## Integration instructions
### CS: preview route and client (`POST /api/signals/preview`, `approveSignal`)
- Read `my_pairs` (counterpart), `my_preset_assignments` and `my_presets` for the caller. Reject the preview client-side if a category isn't allowed.
- Compute `payloadRevision({pairId, recipientId: counterpartHex, supportMode, availability, recipientPolicyVersion, presetAssignmentVersion, consentVersion: DISCLOSURE_CONSENT_VERSION})` and send that number to `approve_signal` unchanged.
- Show the fixed-template preview text for exactly that payload.
- Use a fresh `clientRequestId` per preview, and reuse it only for retries of that same approval.
- Use the new `my_signals` view (sender-only) for the privacy center list and revoke buttons. `my_receipts` is now sender-only.
- Mapper changes: the `approved_signal` row gained `client_request_id`; regenerate bindings after publish.

### CS/AI: nudge commit reducer (next milestone; not implemented)
A `commit_nudge` reducer callable only by an allow-listed worker identity must:
1. Load each source signal plus `loadStanding(sender, pair)`.
2. Call `guardNudgeCommit({pairId, recipientId, templateId, sourceSignalIds, sourceConsentVersions}, sources)` with `nowMs` from `ctx.timestamp`.
3. Insert with the returned clamped `expiresAtMs`.
4. Write a `used` receipt.

The worker cannot create signals or consent.

### AI: worker and coordinator
Replace `FakeDisclosurePolicy` in live mode with `new DisclosurePolicy(reader, clock)`. `reader.load(signalId)` must read authoritative SpacetimeDB state (not the envelope you were handed) and return `{signal: StoredSignal, snapshot: {pair, assignment, preset}}`. Call `check` before each round and before proposing a commit. A pass here is advisory; the reducer re-checks at commit.

## Known gaps (as of this milestone)
- No `commit_nudge` reducer or worker identity yet, so nothing in production creates nudges.
- No expiry sweep, so expired signals and nudges still appear in views until one exists. Reducers enforce expiry at use time.
- Recipient nudge opt-in and recipient-preferences consent (`AgentAck.recipientConsentId`) are not modelled in the module.
- JWT `aud` is not checked (only `iss`). Any Clerk token from the same instance with an allow-listed issuer is accepted.
- No rate limiting on `approve_signal` (repeated-probe threat).
- None of this has run on a published SpacetimeDB module. The CLI is not installed, and the harness is in-process only.
