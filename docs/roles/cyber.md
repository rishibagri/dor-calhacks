# Cyber — Privacy and trust engineering

Branch: `role/cyber-privacy`

Ownership: src/privacy/, authorization policies, privacy tests, retention design

Own TypeScript/Zod schemas, Web Crypto vault/key lifecycle, recipient binding, preset version/assignment enforcement, SpacetimeDB caller-filtered views and reducer authorization with CS. Review provider-bound data and Factory logs. Quiz answers never authorize sharing.

## Deliverables
Hour 3: vault/key design, policy signature and SpacetimeDB access spike. Hour 7: preset consent guards. Hour 12: direct reducer/subscription isolation tests. Hour 22: revocation, preset change and key-lifecycle acceptance.

## Dependencies
CS owns route plumbing; Cyber supplies reusable mandatory guards. AI consumes only validated envelopes. Security ownership includes code, not only documentation.

Before coding: read AGENTS.md and all contracts. Post handoffs to docs/updates/cyber.md. Open small compatible PRs, include verification, and read the other role logs every hour.
