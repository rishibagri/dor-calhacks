# Core flow contract v1 — journal to nudge
Status: proposed by CS (D016–D020); Cyber owns disclosure semantics and must ACK. Executable reference: `contracts/src/disclosure.ts`, pinned by `contracts/tests/flows.test.mjs`. This file states *what must be true at each step*; it does not claim any step is live.

## States
`private` → `candidate` → `previewed` → `approved` | `declined` → `coordinating` → `nudged` | `no_suggestion` → (`revoked` | `expired` | `suppressed` at any point after `approved`)

## Steps, owners and guards
| Step | Where it runs | Owner | Guard (all must hold) | Writes |
|---|---|---|---|---|
| F1 Journal | Device | Cyber vault, AI voice, CS UI | Vault unlocked | Encrypted local entry only |
| F2 Candidate | Device + disclosed transient provider | AI | Output parses `SignalCandidateSchema` (strict enums, no free text). "Space"/no support need ⇒ **no candidate** (D019) | Nothing shared; candidate held in memory |
| F3 Preview | Device | CS UI calls `previewDisclosure` | Pair accepted; preset assigned to *this named recipient*; assignment ↔ preset ids match; preset unrevoked/unexpired; ≥1 candidate field inside preset categories. Blocked fields are **omitted, never substituted** | Nothing. No server learns a candidate existed (D016) |
| F4 Approve | `approve_signal` reducer | CS reducer, Cyber guard | Caller = owner; re-runs `previewDisclosure` on authoritative rows; `sameApprovedPayload` (exact previewed fields); expected preset + assignment versions current; expiry = now + 24h | `ApprovedSignal` v2 + `approved` receipt |
| F4′ Decline | Device | CS UI | — | **Nothing anywhere** |
| F5 Recipient gate | Coordinator + reducer | CS reducer | Recipient opted in **for this pair** (D017, default off); not in quiet hours (default 22:00–08:00 recipient local); ≥24h since last nudge in this pair (D018) | — |
| F6 Coordinate | Factory worker | AI | Reads only approved envelopes + recipient's approved delivery prefs; ≤2 rounds; output is a template ID from `templateForSignal` or "no suggestion"; no free-form text | Proposed nudge (to F7) |
| F7 Commit nudge | `commit_nudge` reducer (worker identity) | CS reducer, Cyber review | Re-check every source signal: unrevoked, unexpired, versions current, pair accepted; re-check F5 at commit time | `Nudge` + `used` receipt |
| F8 Revoke / unlink / tighten | Reducers | CS + Cyber | Owner of signal / pair member / preset owner | Signal revoked; pending + delivered nudges suppressed; `revoked`/`suppressed` receipts |

## What each person sees
- **Owner at F3:** `ownerSentence`, e.g. "Sam may learn that you would welcome a short call, and this week works. A nudge can itself suggest you might want support." plus "won't be shared: coarse availability" for blocked fields, plus `recipientCopy` (the literal nudge text).
- **Recipient at F7:** only `NUDGE_TEMPLATE_COPY[templateId]`. Never the sentence, the reason, the categories, or the candidate.
- **Availability-only approval** produces no nudge (`templateForSignal` = null); the preview says so explicitly.

## Failure cases that must produce nothing shared
Malformed/free-text/nested candidate (`invalid_schema`); wrong recipient; pending or unlinked pair; missing, stale, revoked or expired preset; candidate wholly outside the preset (`blocked_category`, never downgraded); decline; recipient not opted in; quiet hours; cooldown; revoke between F4 and F7; retry of a stale approval.

## Not yet decided / not implemented
- Module wiring: `approve_signal` still refuses; `set_nudge_delivery`, `commit_nudge` and worker identity do not exist yet. Confirm the SpacetimeDB bundle can import `@kinetic/contracts` (zod) before wiring.
- DST: quiet hours use the UTC offset captured when set (D018); recipient must re-save after a DST change until IANA zones are supported.
- User-approved addition: CS-owned Apify catalogue and mutual activity proposals are planned C7 work, gated on new shared schemas/consent and guarded state. Existing C3/F6 template-only flow is unchanged until that review. Aura and group sharing remain outside committed scope. See docs/features/ACTIVITY_DISCOVERY.md.
