# Cyber — Privacy and trust engineering

Branch: `role/cyber-privacy`

Ownership: src/privacy/, authorization policies, privacy tests, retention design

Implement strict validators, session/ownership checks with CS, consent versioning/revocation, pair-scoped permissions, deletion and content-free receipts. Own adversarial boundary tests and privacy copy review.

## Deliverables
Hour 3: validator signature and ownership model. Hour 7: server consent gate. Hour 12: cross-user tests. Hour 22: revocation race and privacy acceptance.

## Dependencies
CS owns route plumbing; Cyber supplies reusable mandatory guards. AI consumes only validated envelopes. Security ownership includes code, not only documentation.

Before coding: read AGENTS.md and all contracts. Post handoffs to docs/updates/cyber.md. Open small compatible PRs, include verification, and read the other role logs every hour.
