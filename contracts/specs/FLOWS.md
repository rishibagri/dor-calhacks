# Core flow contract v1 — journal to nudge
Status: proposed by CS (D016–D020); Cyber ACKed with reconciliation (D026, src/privacy/REVIEWS.md). Executable reference: the single policy in `contracts/src/policy.ts` (zod-free; `evaluateDisclosure`, `guardApproval`, `guardSignalUse`, `guardNudgeCommit`, `nudgeDelivery`, `templateForSignal`) with device wording in `contracts/src/disclosure.ts`, pinned by `contracts/tests/flows.test.mjs` and `policy.test.mjs`. This file states *what must be true at each step*; it does not claim any step is live.

## States
`private` → `candidate` → `previewed` → `approved` | `declined` → `coordinating` → `nudged` | `no_suggestion` → (`revoked` | `expired` | `suppressed` at any point after `approved`)

## Steps, owners and guards
| Step | Where it runs | Owner | Guard (all must hold) | Writes |
|---|---|---|---|---|
| F1 Journal | Device | Cyber vault, AI voice, CS UI | Vault unlocked | Encrypted local entry only |
| F2 Candidate | Device + disclosed transient provider | AI | Output parses `SignalCandidateSchema` (strict enums, no free text). "Space"/no support need ⇒ **no candidate** (D019) | Nothing shared; candidate held in memory |
| F3 Preview | Device | CS UI calls `previewDisclosure` | Pair accepted; preset assigned to *this named recipient*; assignment ↔ preset ids match; preset unrevoked/unexpired; ≥1 candidate field inside preset categories. Blocked fields are **omitted, never substituted** | Nothing. No server learns a candidate existed (D016) |
| F4 Approve | `approve_signal` reducer | CS reducer, Cyber guard | `guardApproval`: caller = owner and pair member (non-member ⇒ not_found); re-runs `evaluateDisclosure` on authoritative rows; request must equal the shareable payload (a blocked field ⇒ deny, never strip); expected preset + assignment versions current; `DISCLOSURE_CONSENT_VERSION`; `payloadRevision` of the previewed payload; expiry = min(now + 24h, preset expiry); `client_request_id` replay is a no-op, never resurrects | `ApprovedSignal` v2 + `approved` receipt |
| F4′ Decline | Device | CS UI | — | **Nothing anywhere** |
| F5 Recipient gate | Coordinator + reducer | CS reducer, Cyber guard | Recipient opted in **for this pair** via their own `set_nudge_delivery` (D017, default off: no row = off); not in quiet hours (default 22:00–08:00 recipient local); ≥24h since last nudge in this pair, counting suppressed/dismissed nudges (D018) | `nudge_delivery` (recipient-owned) |
| F6 Coordinate | Factory worker | AI | Reads only approved envelopes + recipient's approved delivery prefs; ≤2 rounds; output is a template ID from `templateForSignal` or "no suggestion"; no free-form text | Proposed nudge (to F7) |
| F7 Commit nudge | `commit_nudge` reducer (allow-listed worker identity, no account) | CS reducer, Cyber guard | `guardNudgeCommit`: every source passes `guardSignalUse` for this pair/recipient; template = `templateForSignal` of an approved source; the recipient's current preference consent matches the bound `recipient_consent_id/version`, stands and covers the mode (D035); F5 rechecked; `nudge_id` replay is a no-op and never resurrects | `Nudge` + sender-only `used` receipt |
| F8 Revoke / unlink / tighten | Reducers | CS + Cyber | Owner of signal / pair member / preset owner | Signal revoked; pending + delivered nudges suppressed; `revoked`/`suppressed` receipts |

## What each person sees
- **Owner at F3:** `ownerSentence`, e.g. "Sam may learn that you would welcome a short call, and this week works. A nudge can itself suggest you might want support." plus "won't be shared: coarse availability" for blocked fields, plus `recipientCopy` (the literal nudge text).
- **Recipient at F7:** only `NUDGE_TEMPLATE_COPY[templateId]`. Never the sentence, the reason, the categories, or the candidate.
- **Availability-only approval** produces no nudge (`templateForSignal` = null); the preview says so explicitly.

## Failure cases that must produce nothing shared
Malformed/free-text/nested candidate (`invalid_schema`); wrong recipient; pending or unlinked pair; missing, stale, revoked or expired preset; candidate wholly outside the preset (`blocked_category`, never downgraded); decline; recipient not opted in; quiet hours; cooldown; revoke between F4 and F7; retry of a stale approval.

## Not yet decided / not implemented
- Module wiring (role/cyber-privacy, offline harness only, not published): `approve_signal`, `set_nudge_delivery`, `set_support_preferences`/`revoke_support_preferences`, `set_worker_identity`, `commit_nudge`, `sweep_expired` and the worker views are implemented. The module imports `@dor/contracts/policy`, which has no Zod; whether the `spacetime` CLI bundler resolves it is untested until publish.
- Recipient support-preferences consent (D021 `RecipientSupportPreferences`) is stored in the recipient-owned `support_preference` table and bound into `commit_nudge` (D035; offline harness only).
- Coordination outcomes and ACKs describe the recipient and must never be shown to the sender (REVIEWS.md D021 #5).
- DST: quiet hours use the UTC offset captured when set (D018); recipient must re-save after a DST change until IANA zones are supported.
- User-approved addition: CS-owned Apify catalogue and mutual activity proposals are planned C7 work, gated on new shared schemas/consent and guarded state. Existing C3/F6 template-only flow is unchanged until that review. Aura and group sharing remain outside committed scope. See docs/features/ACTIVITY_DISCOVERY.md.
