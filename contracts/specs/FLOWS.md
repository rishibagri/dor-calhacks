# Core flow contract v1 — journal to nudge
Status: proposed by CS (D016–D020); Cyber ACKed with reconciliation (D026, src/privacy/REVIEWS.md). Executable reference: the single policy in `contracts/src/policy.ts` (zod-free; `evaluateDisclosure`, `guardApproval`, `guardSignalUse`, `guardNudgeCommit`, `nudgeDelivery`, `templateForSignal`) with device wording in `contracts/src/disclosure.ts`, pinned by `contracts/tests/flows.test.mjs` and `policy.test.mjs`. This file states *what must be true at each step*; it does not claim any step is live.

## States
`private` → `candidate` → `private_risk_check` → `approved` | `suppressed` → `coordinating` → `nudged` | `no_suggestion` → (`revoked` | `expired` | `suppressed` at any point after approval)

## Steps, owners and guards
| Step | Where it runs | Owner | Guard (all must hold) | Writes |
|---|---|---|---|---|
| F1 Journal | Device | Cyber vault, AI voice, CS UI | Vault unlocked | Encrypted local entry only |
| F2 Candidate | Device + disclosed provider | AI | Output parses `SignalCandidateSchema` (strict enums, no free text). A literal person mention may trigger the flow; no mention, expressed space, malformed assessment, conflict risk or urgent-support risk ⇒ **no relationship candidate** | Candidate remains in owner memory |
| F2a Private risk check | Owner device | CS + AI | Private assessment is in memory only. Interpersonal conflict suppresses this reflection. Serious distress shows a resource card immediately and suppresses the relationship flow. A local keyword fallback may only add this stop. | Nothing shared |
| F3 Automatic approval | Owner client + `approve_signal` reducer | CS reducer, Cyber guard | Exactly one accepted pair was resolved (or the owner clarified); current preset and assignment permit the enum payload; authoritative membership, versions, expiry and pause checks pass. No sender approval tap is required in D050. | `ApprovedSignal` v2 + minimized owner receipt |
| F4 Recipient gate | Coordinator + reducer | CS reducer, Cyber guard | Accepted-pair standard default is on; explicit recipient opt-out for that pair blocks. Quiet hours apply if configured; ≥24h cooldown remains. Missing delivery row means default-on, never overrides invalid pair/preset or pause. | `nudge_delivery` only when customized |
| F5 Coordinate | Factory worker | AI | Reads only approved enum envelopes + standard support styles or recipient custom preferences; ≤2 rounds. The two agents return bounded ACK/options; the coordinator selects a permitted template or no suggestion. Never send journal, names, private risk, or explanation to the peer agent. | Proposed nudge (to F6) |
| F6 Commit nudge | `commit_nudge` reducer (allow-listed worker identity, no account) | CS reducer, Cyber guard | Every source passes `guardSignalUse` for this pair/recipient; template = `templateForSignal` of an approved source; D050 recipient opt-out, pause, quiet-hour and cooldown gates are rechecked; replay never resurrects. D035 custom support preferences are optional preferences; absent customization uses standard modes. | `Nudge` + minimized receipt |
| F8 Revoke / unlink / tighten | Reducers | CS + Cyber | Owner of signal / pair member / preset owner | Signal revoked; pending + delivered nudges suppressed; `revoked`/`suppressed` receipts |

## What each person sees
- **Owner at F3:** `ownerSentence`, e.g. "Sam may learn that you would welcome a short call, and this week works. A nudge can itself suggest you might want support." plus "won't be shared: coarse availability" for blocked fields, plus `recipientCopy` (the literal nudge text).
- **Recipient at F7:** only `NUDGE_TEMPLATE_COPY[templateId]`. Never the sentence, the reason, the categories, or the candidate.
- **Availability-only approval** produces no nudge (`templateForSignal` = null); the preview says so explicitly.

## Failure cases that must produce nothing shared
Malformed/free-text/nested candidate (`invalid_schema`); wrong or ambiguous recipient; pending or unlinked pair; missing, stale, revoked or expired preset; candidate wholly outside the preset (`blocked_category`, never downgraded); expressed space; interpersonal conflict; urgent-support risk; recipient opt-out; quiet hours; cooldown; revoke/pause between approval and commit; retry of stale approval. A serious-distress resource card is local and does not contact a connection.

## Not yet decided / not implemented
- Module wiring (role/cyber-privacy, offline harness only, not published): `approve_signal`, `set_nudge_delivery`, `set_support_preferences`/`revoke_support_preferences`, `set_worker_identity`, `commit_nudge`, `sweep_expired` and the worker views are implemented. The module imports `@dor/contracts/policy`, which has no Zod; whether the `spacetime` CLI bundler resolves it is untested until publish.
- Recipient support-preferences consent (D021 `RecipientSupportPreferences`) is stored in the recipient-owned `support_preference` table and bound into `commit_nudge` (D035; offline harness only).
- Coordination outcomes and ACKs describe the recipient and must never be shown to the sender (REVIEWS.md D021 #5).
- DST: quiet hours use the UTC offset captured when set (D018); recipient must re-save after a DST change until IANA zones are supported.
- User-approved addition: CS-owned Apify catalogue and mutual activity proposals are planned C7 work, gated on new shared schemas/consent and guarded state. Existing C3/F6 template-only flow is unchanged until that review. Aura and group sharing remain outside committed scope. See docs/features/ACTIVITY_DISCOVERY.md.
