# Automatic nudges: owner standing consent (D044)

**Status:** backend implemented and offline-tested by Cyber (`spacetimedb/src/reducers/standing.ts`, `contracts/src/standing-consent.ts`, `spacetimedb/tests/standing.test.ts`). **Off by default.** CS app wiring, AI/DS consumer ACKs, deployment and a live two-account run are still open. Manual per-item preview remains the default and is unchanged for any pair without a valid rule.

## The rule (README D044)
Per-nudge sender preview is optional **only** for a pair where the owner explicitly enabled a revocable, expiring, category-limited standing rule. It is never granted by onboarding answers, a relationship preset, a journal entry, an assessment, model confidence, a provider or the recipient. The recipient must still opt in independently. It is separate from discovery and cannot grant public profile or event consent.

## Owner setup (explicit, before any journal-derived candidate)
`set_standing_consent({pair_id, categories, expires_at, expected_version, expected_policy_version, expected_assignment_version, notice_version})`
- **One named pair**; the caller must be a member and the pair accepted. The recipient is derived server-side.
- **Categories:** non-empty, from `support_preference` / `coarse_availability`, and only ones the owner's current preset for this pair already allows. A preset is a ceiling, never broadened.
- **Versions:** the preset/assignment versions and `STANDING_CONSENT_VERSION` notice the owner was shown; anything else is `stale: stale_policy`.
- **Expiry:** 1 h to 30 days, capped by the preset's expiry. `expected_version` is the current rule version (0 for none).
- **Refused while the owner is pausing that person** (D041).
- Replacing a rule ends the old one's unused approvals first.

**Owner copy (CS):** "Let dor send {name} matching nudges without asking you each time, for {categories}, until {date}. You can turn this off any time. {name} still controls whether they receive nudges." Show it on its own setup screen, never inside the journal flow, with a clear revoke control.

## Automatic approval
`approve_signal_standing({pair_id, support_mode?, availability?, client_request_id, rule_version})`, from the owner's own client, with no preview.
- The server runs every manual check (`guardApproval`: pair, assignment, preset categories, expiry, notice), with the payload revision computed server-side from the rule-bound versions, so the client can't influence it.
- Plus the rule check (`standingRuleStands`: same owner/recipient/pair, current `rule_version`, unrevoked, unexpired, unchanged preset, categories covering the payload) and the D041 pause.
- **No per-event sender alert or receipt** (receipt action `approved_standing` is never projected). The approval is listed in `my_signals` for revocation.

## Delivery (unchanged gates)
The worker and `commit_nudge` still require recipient opt-in, D035 support consent, quiet hours and cooldown, plus the exact rule version that approved each signal (`standingApprovalStands` in `commit_nudge`, `worker_signal_context`, `my_nudges`). Recipient copy stays the fixed template. Suppression is silent to the recipient.

## Revocation and no resurrection
`revoke_standing_consent({pair_id})`, rule replacement, a D041 pause, or unlinking the pair (CS, either member's rule) ends the rule now and revokes its unused approvals and their nudges. Resuming a pause never re-enables a rule; the owner sets a new one. Expiry goes through `sweep_expired`.

## Owner view
`my_standing_consents → {pair_id, categories, version, expires_at, active, created_at}[]`. Join `pair_id` to `my_pairs` for the name. No one else, including the recipient, has a view of rules.

## Errors (owner)
`unauthorized: no_rule | blocked_category | no_preset | paused | recipient_paused`, `stale: stale_policy | revoked | expired | standing rule version changed`, `invalid: too_long | too_short | invalid_schema | pair_not_accepted`, `not_found: pair | standing rule`.

## Consumer checklist
- **CS:** regenerate bindings; build the setup/revoke screen with the copy above; only call `approve_signal_standing` for a candidate the owner's decision loop resolved to that pair (a uniquely chosen recipient, never auto-chosen); keep manual preview as the default.
- **AI:** no worker change (automatic approvals are ordinary signals in `worker_signal_context` while the rule stands).
- **DS:** evaluate that the assessment, quiz or journal can never create a rule, and that a pause or revoke stops queued automatic nudges.
