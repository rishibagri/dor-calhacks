# @dor/contracts — shared interface specification
Read this after AGENTS.md and PRD.md. This is the interface index; `src/schemas.ts` is the canonical source for wire shapes, `src/ports.ts` defines adapter boundaries, `schema/` contains generated JSON Schema, and `fixtures/` holds synthetic valid examples. Every role uses this one package on main; no branch-private contracts.

| ID | Interface | Producer → Consumer | Responsible owner | Boundary |
|---|---|---|---|---|
| C1 | LocalConnectionProfile / PrivateReflectionPort → PrivateReflection + SignalCandidate / VoicePort → VoiceSession | DS quiz + local UI → owner-only profile; AI transient reasoning → local vault; AI voice adapter → CS routes | DS (quiz), AI (reflection, voice), Cyber (vault) | Private; never shared-state subscription. Candidate is an enum-only draft, never consent. Optional owner-only `assessment` (D040: intent + explicit name exclusions/preferences) only narrows the private decision loop and is never persisted or sent |
| C2 | RelationshipPreset / RecipientPresetAssignment | Owner-confirmation UI → policy/reducers → preview and coordination guards | Cyber; CS consumes | Named recipient, confirmed preset, versions, no per-person overrides |
| C3 | ApprovedSignal v2 | Guarded approval reducer → Factory/recipient agent | Cyber produces; AI consumes | Explicit minimal disclosure; no raw context |
| C4 | AgentAck / CoordinationPort / RecipientSupportPreferences / CoordinationJob / CoordinationOutcome | Recipient's approved preferences → bounded coordinator; content-free job → worker; sanitized outcome codes | AI; Cyber/CS produce preferences consent and jobs; DS and CS consume | Maximum two rounds; no free-form agent chat; jobs carry IDs only |
| C5 | Nudge / DisclosureReceipt | Guarded coordination commit → caller-filtered views/UI | CS; Cyber reviews | Revalidate consent/preset before delivery |
| C6 | Disclosure guards (`@dor/contracts/policy`), DisclosurePolicy / DisclosurePolicyPort; fake clock/store | Cyber policy → reducers, worker and integration checks | Sumedh (Cyber); all consume | Guards are dependency-free and run inside reducers; fakes are offline-only and not security evidence. See src/privacy/README.md |
| C7 (partial) | Public catalogue input/link guards; catalogue and shared-plan types pending | CS Apify ingestion → Nimisha ranking → Adam workflow → CS UI | CS owns catalogue; Sumedh guards | D028 guards executable; shared activity/event delivery still requires reviewed schemas/consent |
| C8 (proposed) | Discovery publication, coarse area, public profiles, event intent and introductions | Owner opt-in → Cyber/CS guarded state → DS/AI shortlist → authorized UI | CS state/UI; Cyber consent; DS ranking; AI workflow | Separate from pair support; public-profile preview before invite acceptance; runtime shapes not yet exported |

## Named owners and implementation locations
- **CS (you):** module/client plumbing, caller-filtered delivery, real adapter wiring and C7 catalogue ingestion.
- **Nimisha (DS):** quiz/profile semantics, matching, labeled scenarios and quality evaluation.
- **Adam (AI):** transient provider reflection/voice and bounded coordination. His additive D021 contracts and adapters are now merged through PR #4, with consumer review/integration still pending; do not redefine parallel types.
- **Sumedh (Cyber):** vault, real authorization semantics, preset/item/assignment validation, privacy reviews and adversarial checks.

See [the owner/consumer dependency matrix](../docs/PLAN.md). Current app-side adapters are declared in `src/lib/backend/ports.ts`; they are integration seams, not alternative shared wire specifications. The current app-side `ReflectionPort` still returns reflection only; Adam’s merged PrivateReflection response is richer than the app-side ReflectionPort: reconcile that app seam in one reviewed change before wiring candidate extraction. Main d7285eb includes guarded `approve_signal`, `set_nudge_delivery`, `commit_nudge`, worker views and LocalVault. Recipient support-preference consent storage/commit binding, app wiring and live proof remain.

## Interface lifecycle and review
1. Producer claims the change with affected consumers. For cross-role changes, include a phase task ID and exact files in the update log.
2. Agree request/response, private/shared classification, identity source, rejection cases, version/retry semantics and fixtures before dependent code.
3. Change canonical source schema/ports, regenerate JSON Schema, and update fixtures/tests/specs in the same PR. Bump a wire version on breaking changes.
4. Consumer validates a meaningful fixture/real adapter call and ACKs the handoff. Sumedh reviews any disclosure or auth boundary.
5. Merge shared definitions to main; roles merge main into their own active branches, preserving work. Do not force-sync branches or count a proposal as shipped.

## Planned C7 — activity source and mutual plan
Public catalogue ingestion does not authorize user-interest sharing. Existing ApprovedSignal v2 permits only support preference and coarse availability; do not overload its strings with activity IDs, free text, precise calendars or raw quiz extras.

Before an activity proposal is shared, CS, Nimisha, Adam and Sumedh must agree on catalogue item/proposal types, explicit new disclosure categories, exact named preview, source provenance, proposal revision, independent participant acceptance, expiry, cancellation and guarded commit. Update source schemas/fixtures/checks together. Until then, catalogue browsing may remain read-only; no model can infer consent. Detailed [feature boundary](../docs/features/ACTIVITY_DISCOVERY.md).

## Commands
From repository root: `npm ci`, then `npm run check`. `npm run contracts:schema` regenerates schemas after a shape change. All checks are offline; no provider calls, deployment, journal access or external messages.

## Rules
- Import production types/schemas/ports from `@dor/contracts`. Tests may explicitly import `@dor/contracts/fakes`; production adapters must not. The SpacetimeDB module imports guards from `@dor/contracts/policy` (no Zod in its bundle).
- Zod strict schemas reject extra fields. Top-level wire records carry `schemaVersion`. Missing optional fields are omitted; never invent a value to bypass a blocked category.
- UTC ISO timestamps with timezone; injected clocks for deterministic examples. The synthetic fixture's far-future expiry is not a runtime default.
- Schema validity is not permission. Authoritative reducers verify identity, relationship, preset assignment/version, exact owner approval, purpose, expiry and revocation on each use.
- The in-memory fake policy/store exists only to unblock development. It has no cryptographic, authentication, persistence or concurrency guarantees and must never be wired into live mode.
- Changing an interface requires the producer and affected consuming owner to review the same PR; Cyber reviews privacy boundaries. Update inferred types, generated schemas, fixtures, checks, docs and handoffs together. Breaking wire changes bump schemaVersion.
- Source-of-truth order: user decisions → PRD/decision log → interface spec/schema → measured verification → older handoffs. Conflicts must be resolved, not silently overridden.

Merged via PR #4 (D021; Cyber ACK with conditions in src/privacy/REVIEWS.md, remaining consumer ACK/integration tracked in handoffs): the C1 additions `PrivateReflection` (`src/reflection.ts`; it reuses FLOWS.md's `SignalCandidateSchema`, with null for nothing to share), `VoiceSession` and `VoicePort`, and the C4 additions `RecipientSupportPreferences`, `CoordinationJob`, `CoordinationOutcome` and `CoordinationPort.outcomes` (codes include FLOWS.md F5's `not_opted_in` and `quiet_hours`). All are additive; no existing wire shape or schemaVersion changes.

## Detailed contracts
- [Architecture](specs/ARCHITECTURE.md)
- [API/reducers/views](specs/API.md)
- [Privacy](specs/PRIVACY.md)
- [Quiz and relationship presets](specs/ONBOARDING_SHARING.md)
- [Agent protocol](specs/AGENTS_PROTOCOL.md)
- [Acceptance/evaluation](specs/ACCEPTANCE.md)
- [Core flow journal to nudge](specs/FLOWS.md) — executable reference `src/disclosure.ts`
- [C8 discovery proposal](specs/DISCOVERY.md) — explicit public profiles, coarse area and event-intent boundaries

## Status
Main d7285eb includes the real local vault, canonical policy, guarded approval/delivery/commit, worker views, AI routes/voice helpers and DS ranking. App wiring, authoritative recipient preference consent, deployment and live proof remain. D028 C7 input/link guards are executable; catalogue/proposal schemas and C8 are pending. This documentation reset changes no runtime wire shapes. Package checks do not establish live deployment or end-to-end isolation.

## C8 review gate and C7 relationship
C8 publication lets eligible discoverers see deliberately published profile fields before an invitation is accepted. It does not grant support-signal access or automatically assign a friend preset. Event intent is explicit and revocable, never scraped attendance. C7 governs source-backed catalogue/proposal data and independent plan acceptance; C8 governs discovering people and publication audience. CS/Sumedh propose canonical types; Nimisha/Adam review consumers. Source schemas, generated schema, fixtures and direct guard tests land together. See specs/DISCOVERY.md. The existing D028 Apify input guard still rejects location; do not encode a user-derived area as a topic or locale.
