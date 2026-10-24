# Automatic nudges: standing rule (D047)

Status: implemented and verified offline in the in-process harness only. Not published, not live, no UI. CS (Rishi) owns it; Cyber review requested.

## What it is

An owner can create a **standing rule** for one accepted pair so the app may approve a matching signal without the per-item preview. This is README rules 5 and 7. It is an owner choice about disclosure only; it changes nothing the recipient sees.

A rule is never created by a quiz, a preset, a journal entry, model confidence, or a recipient preference. It is off by default and exists only because the owner called `set_standing_rule`.

## Rule shape

`standing_rule` (private table, one row per owner + pair, updated in place):

| Field | Meaning |
|---|---|
| `rule_id` | server-minted |
| `owner`, `pair_id` | both indexed; the recipient is derived from the pair |
| `support_modes`, `availability` | unique enum values, at least one value in total |
| `purpose` | `support_check_in` (fixed enum; no free text) |
| `version` | bumped on every set and every revoke |
| `expires_at` | 1 hour to 30 days from now (`STANDING_RULE_MIN_MS` / `STANDING_RULE_MAX_MS`) |
| `revoked_at` | set when revoked |

The preset and assignment for this recipient are the **ceiling**. A rule is checked against the current preset at creation and again at every approval, so tightening a preset after the rule exists narrows what the rule can do; it never widens.

## Interfaces

- `set_standing_rule({pair_id, support_modes, availability, purpose, expires_at (ISO), expected_version})`. Owner of an accepted pair only (non-members get `not_found: pair`). Refused while the owner is pausing the recipient (`unauthorized: recipient_paused`) and when outside the preset (`unauthorized: blocked_category`). `expected_version` is the version in `my_standing_rules` (0 for none). Setting again bumps the version and revokes undelivered signals approved under the older one.
- `revoke_standing_rule({pair_id, expected_version})`. Revokes the rule and its undelivered signals. Idempotent for an already-revoked rule. No rule means `not_found: rule`.
- `approve_signal_by_rule({pair_id, support_mode?, availability?, rule_version, client_request_id})`. Writes the same `approved_signal` and `approved` receipt as `approve_signal`, with the preset versions read by the server, so the worker and `commit_nudge` path is unchanged. The row records `rule_id` and `rule_version`. `client_request_id` is the same sender-scoped idempotency key as `approve_signal`: a replay returns without effect, never resurrects a revoked signal, and a manual approval cannot reuse a by-rule id (or the reverse).
- View `my_standing_rules {pair_id, support_modes, availability, purpose, version, expires_at, active}`, owner-only. The counterpart, third accounts and the worker have no view of the table.
- Contracts (`@dor/contracts`, reducer-safe parts also from `@dor/contracts/policy`): `guardRuleCreation`, `guardRuleApproval`, `standingRuleActive`, `StandingRuleState`, `STANDING_RULE_MIN_MS`, `STANDING_RULE_MAX_MS`, `STANDING_RULE_PURPOSES`, and `StandingRuleSchema` (Zod, root export only; schema `contracts/schema/standing-rule.schema.json`). Denials reuse the existing reason codes and `policyErrorCode` mapping.

## Recheck points

1. `approve_signal_by_rule`: pause first, idempotency, then `guardRuleApproval`: pair membership, rule exists / not revoked / not expired / version matches / payload inside the rule, then the same F3 evaluation as `guardApproval` against the current preset and assignment. The signal expiry is `min(now + 24 h, preset expiry, rule expiry)`.
2. `commit_nudge`: for each source signal with a rule, the rule must still be the same version, unrevoked and unexpired (`stale: revoked`, the same message as any revoked approval). The existing checks run unchanged: source standing, D041 pause, recipient consent, opt-in, quiet hours and cooldown.
3. `worker_signal_context` and `my_nudges` drop signals whose rule no longer stands. Views have no clock, so expiry there uses the `standing_rule` marker written by `sweep_expired`; the rule expiry is also the signal expiry, so a rule signal can never outlive its rule.

## Revoke, pause, unlink

- `revoke_standing_rule` and re-setting a rule revoke undelivered rule signals with the same sender-only `revoked` receipt as `revoke_signal`. A signal already used by a nudge is left alone: delivery happened.
- `pause_recipient` revokes the owner's rule in that pair in the same transaction (the existing pause already revokes every standing approval and suppresses their nudges). Resume restores nothing; the owner must set a new rule.
- `unlink_pair` revokes every rule in the pair.

## What the recipient sees

Nothing different. The same fixed nudge templates, no per-event alert to the sender, and no receipt, view column or error revealing automatic versus manual. The worker view has no rule field, and a revoked rule fails with the same code as an ordinary revocation. The owner's `my_signals` includes `rule_id` / `rule_version` (owner-only). The recipient `my_nudges` row is byte-identical for manual and rule approvals (tested).

## Limits and open items

- Offline only. No UI, no client wiring, nothing published, no live check.
- One rule per owner + pair. No per-signal quota beyond the existing 24 h per-pair nudge cooldown.
- Rule expiry is checked by the reducer clock; views rely on the 60 s sweep (bounded stale window, as for pauses).
- The numbering is provisional: the README says D044, but D044 is the opaque-id proposal and D047 is Cyber's discovery boundary. The decision is recorded in `docs/DECISIONS.md` as D047.
- Cyber review requested: `rule_id` in `my_signals`, the delivered-versus-undelivered revoke distinction, and the `approved` receipt shape for rule approvals.
- Tests: `spacetimedb/tests/standing_rule.test.ts`, `contracts/tests/standing-rule.test.mjs`.
