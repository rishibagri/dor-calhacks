# Privacy contract v2 — Cyber owns acceptance
## Disclosure policy
For an accepted pair with a current assigned relationship preset, in-app nudges are enabled by default. The recipient can opt out for that pair; a missing delivery-preference row means the standard default is on. There is no per-nudge sender approval step in the current product flow. The server still validates pair membership, preset/category, signal lifetime/revocation, recipient opt-out, pause, quiet hours and cooldown before delivery. Legacy item-approval and D044 standing-consent APIs remain compatibility paths, not prerequisites for the active D050 flow. No personal message is sent outside dor.

For existing pair support, allowed shared fields are only those in ApprovedSignal in contracts/src/index.ts. Use enumerated support preferences and coarse availability. No free text, source journal ID, quote, explanation, timestamp of journaling, precise schedule/location, medical/financial/sexual facts, third-party names, or embeddings. The private reflection may be freely worded; its candidate is enum-only and held in owner memory. The active D050 flow may submit that candidate to the authoritative approval reducer automatically only after a unique accepted-pair match and a successful private risk check. This product trigger is not permission to send journal content: only the reducer-approved enum fields may cross the pair boundary.

Deterministic code validates schema, membership, current preset assignment/version, expiry, revocation, recipient opt-out, pause and allowed purpose before storage, each exchange, nudge generation, and delivery. Agents cannot grant authority or widen the allowlist. No summarization-based workaround. Reject unknown fields and nested payloads. Journal instructions are untrusted input. Private risk assessment may only suppress the current reflection; it may never authorize a disclosure.

Construct recipient copy from fixed templates and approved enums; do not invite an LLM to explain hidden causes. Never say a generic nudge is unrelated to journaling if it was triggered by a shared signal.

## Threat tests required
Cross-account journal GET/DELETE; pair ID tampering; unaccepted invite; malicious transcript asking to disclose secrets; model extra fields/encoded content; expiry; unlink; revoke before coordination; revoke during generation; stale retry after revoke; unauthorized nudge read; logs/error/analytics leakage; repeated probes to infer blocked facts. Revocation cannot erase information already seen; state that honestly.

## Data lifecycle
Audio transient by default; visibly disclose provider processing. Owner can correct or delete transcript. Deletion immediately removes app access and revokes derived signals; document actual primary-store cleanup, backups, and provider retention separately. Audit only IDs/actions/versions with restricted access, never content. Synthetic test data only until live-data boundaries pass. Any provider data-retention claim must be verified in that provider's current settings/docs before launch.

## Honest privacy copy
"Your journal is not shared with your connection. For accepted connections, dor may use limited, preset-approved signals to decide whether to show an in-app nudge; either person can opt out or pause the connection. Our processing providers handle audio/text to provide the service. A nudge may still let someone infer that you would welcome support."

This is data minimization and access control, not a mathematical privacy guarantee or end-to-end encrypted inference.

## Recipient rules and quiz
See ONBOARDING_SHARING.md. Owner-confirmed relationship-preset/category/purpose policy is bound to the accepted pair. The quiz personalizes communication style, support preferences, social bandwidth and sharing preferences, but answers and inferred styles remain local; they cannot grant authority, change recipients or modify presets. Under D050, an accepted pair's permitted in-app nudge flow is automatic unless the recipient opts out or another server gate blocks it. All aura/card/matching outputs are disclosures subject to their separate audience checks.

## Storage and processing update
Journals, raw quiz answers, detailed schedules and private candidates persist only in the encrypted IndexedDB vault. Selected content may be processed transiently by the disclosed Cartesia/Claude pipeline. Next.js must suppress request-body logging and caching for these routes. Factory sees approved structured signals only. SpacetimeDB stores minimized consent/shared-state metadata with caller-filtered views, never a journal table. Cyber must verify provider retention and runtime logging behavior; local deletion cannot promise provider deletion without a verified provider mechanism.

## Separate discovery publication (proposed C8)
The user chose opted-in public profiles before mutual invitation acceptance. Support this with explicit publication of chosen fields/audience/purpose/expiry, not by making private tables public or applying pair presets to strangers. Public profile consent never releases journals, emotional inferences, raw quiz answers, contact details, exact location or habitual routines. Coarse area membership is private eligibility, not a live location indicator. Models cannot expand publication.

Withdraw, block, expire and profile edits invalidate pending derived discovery; rate-limit invitations and repeated probes. Only approved nonsensitive overlap reasons can be displayed. Event intention is separately published and self-declared; catalogue scraping must not infer attendees. Authentication/caller-filtered views and timed expiry need direct tests before rollout. Previously viewed published information cannot be recalled. Detailed proposed records/guards are in DISCOVERY.md.
