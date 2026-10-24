# Architecture contract v2 — Kinetic
Selected technologies: see docs/TECH_STACK.md. This supersedes the server-stored Postgres journal design.

## Trust zones and data flow
1. Next.js browser: owner unlocks a local IndexedDB/Web Crypto vault. Raw audio, transcripts, quiz responses, detailed calendar entries and private candidate drafts remain local at rest.
2. Explicitly disclosed provider processing: owner-selected content can be sent transiently through an authenticated, non-logging API to Cartesia or Claude. Store returned private reflection/candidate locally. No persistent journal/candidate endpoint or raw-context SpacetimeDB table.
3. Owner reviews an exact disclosure preview for a named recipient. TypeScript/Zod validates the envelope. An authoritative SpacetimeDB reducer verifies authenticated sender, accepted relationship, current assigned relationship-preset policy, category, purpose, expiry and exact approved payload; commits consent and signal atomically.
4. Factory worker receives content-free work IDs and approved signals only. It executes bounded coordination with Claude-backed reasoning as configured, never vault access. Before each use and before committing a nudge, revalidate current consent versions. Model output never grants authority.
5. SpacetimeDB private tables hold only necessary account/pair metadata, policies, approved signals, coordination jobs, nudges and sanitized receipts. Caller-filtered views expose only authorized rows/columns; live subscriptions never expose raw private tables. Quiz types and raw answers are absent from shared state.
6. Connected users receive authorized live updates. Revocation/unlink invalidates eligible source records, pending jobs, and derived nudges. Clear client caches on invalidation/reconnect; previously seen information cannot be recalled.

## Identity and worker boundary
CS and Cyber verify Clerk/OIDC mapping to SpacetimeDB caller identity during the first spike. Never trust client-supplied owner/sender IDs. Worker identity may read approved work and propose results; it cannot create owner consent or impersonate an approval. Reducers independently enforce guards even when API/worker validation is bypassed. No provider requests inside reducers; external work runs in the compatible worker and returns through version-checked reducers.

## Local vault requirements
Cyber owns key lifecycle: AES-GCM with fresh unique IV per encryption, authenticated metadata/version, explicit unlock/lock behavior, and an agreed key derivation/recovery design before implementation. Do not save plaintext keys beside ciphertext and call that protection. A nonextractable persisted browser key alone does not create a meaningful unlock boundary. XSS and an unlocked browser can still expose decrypted data; keep the UI isolated from untrusted markup. Initial vault is single-device; account login does not restore its key. No silent upload/recovery or cross-device sync. Show data-loss implications before clearing storage; define export/recovery separately if implemented.

Client-side vault encryption protects persisted data, not data during authorized cloud processing. Receipt and consent metadata are minimized but still personal data with restricted views. No global embeddings, journal summaries or quiz answer subscriptions.
