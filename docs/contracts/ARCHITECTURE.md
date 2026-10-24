# Architecture contract v1
Proposed stack: TypeScript monorepo; responsive React web app; server API; Postgres with row ownership policies; provider adapters for Cartesia and an LLM. Hosting/provider specifics are implementation decisions at the minute-20 freeze.

Trust zones: browser → authenticated server → owner-only journal store/private agent → deterministic disclosure policy → approved signal store → bounded coordinator/recipient agent → recipient nudge inbox.

Private agent has only its owner's journal access. Coordinator and recipient agent have no journal-store credentials or tools. Their inputs are validated signals and recipient-approved preferences. Separate modules and database permissions enforce this; separate prompts alone do not.

Private tables: journals(owner_id, encrypted_content, created_at, delete_state); candidates(owner_id, private_journal_id, candidate_payload). Shared table: approved_signals(id, pair_id, sender_id, recipient_id, allowed_payload, consent_version, expires_at, revoked_at). Others: users, accepted pairs, consents, nudges, feedback, content-free audit events. Private foreign keys stay server-side.

Each read/write derives identity from authenticated session. Never trust owner_id supplied by a browser. Pair invitation requires acceptance. Unlink invalidates pair-scoped consent and suppresses queued nudges. No raw journal embeddings or vectors in shared stores. TLS and storage encryption are required; key management and provider processing disclosures remain explicit implementation tasks.
