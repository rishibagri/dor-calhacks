# Privacy contract v2 — Cyber owns acceptance
## Disclosure policy
Default: no sharing. Approval is per recipient/pair, exact signal revision, purpose (support nudge), and expiry; default lifetime 24 hours. The owner sees the same semantic preview the other person may receive. No hidden inferred mood export. Recipient must opt into nudges too.

Allowed shared fields are only those in ApprovedSignal in packages/contracts/index.ts. Use enumerated support preferences and coarse availability. No free text, source journal ID, quote, explanation, timestamp of journaling, precise schedule/location, medical/financial/sexual facts, third-party names, or embeddings. Even availability is disclosed only with explicit approval. A private candidate may be freely worded internally, but only the schema-constrained form can cross the boundary.

Deterministic code validates schema, membership, current consent version, exact approved payload, expiry, revocation, and allowed purpose before storage, each exchange, nudge generation, and delivery. Agents cannot self-approve consent. No summarization-based workaround. Reject unknown fields and nested payloads. Journal instructions are untrusted input.

Construct recipient rationale from fixed templates and approved enums; do not invite an LLM to explain hidden causes. If more individualized text is required, require a separate owner preview and approval before delivery. Never say a generic nudge is unrelated to journaling if it was triggered by a shared signal.

## Threat tests required
Cross-account journal GET/DELETE; pair ID tampering; unaccepted invite; malicious transcript asking to disclose secrets; model extra fields/encoded content; expiry; unlink; revoke before coordination; revoke during generation; stale retry after revoke; unauthorized nudge read; logs/error/analytics leakage; repeated probes to infer blocked facts. Revocation cannot erase information already seen; state that honestly.

## Data lifecycle
Audio transient by default; visibly disclose provider processing. Owner can correct or delete transcript. Deletion immediately removes app access and revokes derived signals; document actual primary-store cleanup, backups, and provider retention separately. Audit only IDs/actions/versions with restricted access, never content. Synthetic test data only until live-data boundaries pass. Any provider data-retention claim must be verified in that provider's current settings/docs before launch.

## Honest privacy copy
“Your journal is not shared with your connection. You choose which limited signals can be used for nudges. Our processing providers handle audio/text to provide the service. A nudge may still let someone infer that you would welcome support.”

This is data minimization and access control, not a mathematical privacy guarantee or end-to-end encrypted inference.

## Recipient rules and quiz
See ONBOARDING_SHARING.md. Owner-confirmed relationship-preset/category/purpose policy bound to the named recipient and exact per-item consent are both required. Quiz answers and inferred connection styles remain local; they cannot grant sharing, change recipients, or modify active permissions. An allowed category never bypasses an item approval. All aura/card/matching outputs are disclosures subject to the same audience checks.

## Storage and processing update
Journals, raw quiz answers, detailed schedules and private candidates persist only in the encrypted IndexedDB vault. Selected content may be processed transiently by the disclosed Cartesia/Claude pipeline. Next.js must suppress request-body logging and caching for these routes. Factory sees approved structured signals only. SpacetimeDB stores minimized consent/shared-state metadata with caller-filtered views, never a journal table. Cyber must verify provider retention and runtime logging behavior; local deletion cannot promise provider deletion without a verified provider mechanism.
