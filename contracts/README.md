# @kinetic/contracts — shared interface specification
Read this after AGENTS.md and PRD.md. This is the interface index; `src/schemas.ts` is the canonical source for wire shapes, `src/ports.ts` defines adapter boundaries, `schema/` contains generated JSON Schema, and `fixtures/` holds synthetic valid examples. Every role uses this one package on main; no branch-private contracts.

| ID | Interface | Producer → Consumer | Responsible owner | Boundary |
|---|---|---|---|---|
| C1 | LocalConnectionProfile / PrivateReflectionPort | DS quiz + local UI → owner-only profile; AI transient reasoning → local vault | DS (quiz), AI (reflection), Cyber (vault) | Private; never shared-state subscription |
| C2 | RelationshipPreset / RecipientPresetAssignment | Owner-confirmation UI → policy/reducers → preview and coordination guards | Cyber; CS consumes | Named recipient, confirmed preset, versions, no per-person overrides |
| C3 | ApprovedSignal v2 | Guarded approval reducer → Factory/recipient agent | Cyber produces; AI consumes | Explicit minimal disclosure; no raw context |
| C4 | AgentAck / CoordinationPort | Recipient's approved preferences → bounded coordinator | AI; DS and CS consume | Maximum two rounds; no free-form agent chat |
| C5 | Nudge / DisclosureReceipt | Guarded coordination commit → caller-filtered views/UI | CS; Cyber reviews | Revalidate consent/preset before delivery |
| C6 | DisclosurePolicyPort / fake clock/store | Cyber policy → reducers, worker and integration checks | Cyber; all consume | Fake implementations are offline-only and not security evidence |

## Commands
From repository root: `npm ci`, then `npm run check`. `npm run contracts:schema` regenerates schemas after a shape change. All checks are offline; no provider calls, deployment, journal access or external messages.

## Rules
- Import production types/schemas/ports from `@kinetic/contracts`. Tests may explicitly import `@kinetic/contracts/fakes`; production adapters must not.
- Zod strict schemas reject extra fields. Top-level wire records carry `schemaVersion`. Missing optional fields are omitted; never invent a value to bypass a blocked category.
- UTC ISO timestamps with timezone; injected clocks for deterministic examples. The synthetic fixture's far-future expiry is not a runtime default.
- Schema validity is not permission. Authoritative reducers verify identity, relationship, preset assignment/version, exact owner approval, purpose, expiry and revocation on each use.
- The in-memory fake policy/store exists only to unblock development. It has no cryptographic, authentication, persistence or concurrency guarantees and must never be wired into live mode.
- Changing an interface requires the producer and affected consuming owner to review the same PR; Cyber reviews privacy boundaries. Update inferred types, generated schemas, fixtures, checks, docs and handoffs together. Breaking wire changes bump schemaVersion.
- Source-of-truth order: user decisions → PRD/decision log → interface spec/schema → measured verification → older handoffs. Conflicts must be resolved, not silently overridden.

## Detailed contracts
- [Architecture](specs/ARCHITECTURE.md)
- [API/reducers/views](specs/API.md)
- [Privacy](specs/PRIVACY.md)
- [Quiz and relationship presets](specs/ONBOARDING_SHARING.md)
- [Agent protocol](specs/AGENTS_PROTOCOL.md)
- [Acceptance/evaluation](specs/ACCEPTANCE.md)
- [Core flow journal to nudge](specs/FLOWS.md) — executable reference `src/disclosure.ts`

## Status
Shared setup and offline contract scaffolding only. Providers, vault encryption, SpacetimeDB reducers/views and application screens are not implemented or live-verified by this package.
