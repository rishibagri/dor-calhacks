# Automatic connection nudges (D050; supersedes D044 product behavior)

**Current product rule:** nudges for accepted connections are automatic by default. There is no standing-consent setup and no sender approval for each nudge. The recipient can turn nudges off per connection. Current relationship presets, account/pair checks, server validation, pause, quiet-hour and cooldown controls remain enforced. Delivery stays inside dor; the app never sends a personal message as the user.

The D044 reducers and views remain in the module for compatibility and history, but this product flow does not call `approve_signal_standing` or require a D044 rule. D050 supersedes D044's opt-in and manual-review product requirements; it does not erase the old implementation record.

## Trigger and recipient resolution

- A private reflection may identify names literally mentioned by the writer (`mentionedNames`, max 5). Those names stay in browser memory and never enter SpacetimeDB, Factory, Droid, shared prompts, logs or analytics.
- If exactly one mentioned name matches exactly one accepted connection on-device, the app automatically sends only the allowed enum signal through `approve_signal`. If there are multiple names, an ambiguous match, or no accepted match, ask the writer to choose or take no action.
- The signal is limited to the category and fields already allowed by the current relationship preset. Never send journal text, transcript, inferred sensitive fact, reason, event, location or private assessment.
- The agents consider the approved signal together with current relationship state and delivery constraints. They may return no nudge. They cannot expand the audience or add facts from the journal.

## Conflict and urgent-support stops

The owner-only assessment adds `risk: none | interpersonal_conflict | urgent_support`. Any non-`none` risk suppresses the entire connection workflow for that reflection, even if the model also returned a candidate. Examples for `interpersonal_conflict` include a hidden activity, an excuse, a declined invitation followed by another plan, or any likely disclosure that could create friction. The app does not tell a connection why it held back.

`urgent_support` covers serious mental-health distress, including depression, hopelessness, self-harm thoughts or immediate danger. Show the support-resource card immediately after reflection; do not contact friends, family or any other connection. A browser-local high-recall term check can show the card even if the model misses a term; this is not a diagnosis and may show resources for quoted or negated terms. The current card offers U.S. 988 phone, text and chat resources; localization is not implemented. The assessment and journal remain private. Provider/model failure must never enable a nudge that was otherwise held.

## Recipient controls and server gates

- Accepted pairs use dor's standard in-app nudge types by default. Missing support-style settings mean the standard types; those settings personalize the offer, they do not authorize journal disclosure.
- Each recipient can disable in-app nudges for an individual connection. A persisted `opted_in: false` is authoritative; missing delivery rows use `DEFAULT_RECIPIENT_DELIVERY` (on). Quiet hours and 24-hour per-pair cooldown apply when configured.
- `pause_recipient` remains a durable sender-side no-contact boundary; an active pause suppresses pending work. Explicit exclusions and risk flags also stop the current reflection. No pause/exclusion reason is sent to the other person.
- `approve_signal` checks accepted-pair membership, current preset/assignment, category, payload and idempotency. `commit_nudge` rechecks current source validity, recipient opt-out, recipient support styles, pause, quiet hours and cooldown. A failure means no nudge; never fall back to manual sender approval.
- Recipient controls include clear per-connection off/on and pause/resume actions. Turning nudges off hides pending work; unlinking revokes pair work.

## Required validation

Test the unique-name automatic path, ambiguous/multiple names, recipient opt-out, current-preset denial, conflict risk, serious-distress resource card, provider failure, pause/revoke races, quiet hours, cooldown, and that journal text/reason never appears in peer-visible rows or agent state. Keep deployment/live verification distinct from offline tests. No paid provider calls or Maincloud changes are implied by this specification.
