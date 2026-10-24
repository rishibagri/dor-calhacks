# @kinetic/contracts — shared interface specification
Read this after AGENTS.md and PRD.md. This is the interface index; `src/schemas.ts` is the canonical source for wire shapes, `src/ports.ts` defines adapter boundaries, `schema/` contains generated JSON Schema, and `fixtures/` holds synthetic valid examples. Every role uses this one package on main; no branch-private contracts.

| ID | Interface | Producer → Consumer | Responsible owner | Boundary |
|---|---|---|---|---|
| C1 | LocalConnectionProfile / PrivateReflectionPort | DS quiz + local UI → owner-only profile; AI transient reasoning → local vault | DS (quiz), AI (reflection), Cyber (vault) | Private; never shared-state subscription |
| C2 | RelationshipPreset / RecipientPresetAssignment | Owner-confirmation UI → policy/reducers → preview and coordination guards | Cyber; CS consumes | Named recipient, confirmed preset, versions, no per-person overrides |
| C3 | ApprovedSignal v2 | Guarded approval reducer → Factory/recipient agent | Cyber produces; AI consumes | Explicit minimal disclosure; no raw context |
| C4 | AgentAck / CoordinationPort | Recipient's approved preferences → bounded coordinator | AI; DS and CS consume | Maximum two rounds; no free-form agent chat |
| C5 | Nudge / DisclosureReceipt | Guarded coordination commit → caller-filtered views/UI | CS; Cyber reviews | Revalidate consent/preset before delivery |
| C6 | DisclosurePolicyPort / fake clock/store | Cyber policy → reducers, worker and integration checks | Sumedh (Cyber); all consume | Fake implementations are offline-only and not security evidence |
| C7 (planned) | Activity catalogue and shared-plan proposal | CS Apify ingestion → Nimisha ranking → Adam workflow → CS UI | CS owns; Sumedh privacy review | Documentation only until new schemas/consent transitions are reviewed |

## Named owners and implementation locations
- **CS (you):** module/client plumbing, caller-filtered delivery, real adapter wiring and C7 catalogue ingestion.
- **Nimisha (DS):** quiz/profile semantics, matching, labeled scenarios and quality evaluation.
- **Adam (AI):** transient provider reflection/voice and bounded coordination. His D016 additions currently appear on the AI role branch; review/merge them rather than redefining parallel types.
- **Sumedh (Cyber):** vault, real authorization semantics, preset/item/assignment validation, privacy reviews and adversarial checks.

See [the owner/consumer dependency matrix](../docs/PLAN.md). Current app-side adapters are declared in `src/lib/backend/ports.ts`; they are integration seams, not alternative shared wire specifications. Current `PrivateReflectionPort` on inspected main returns reflection only, while Adam’s proposed response is richer: resolve that in one reviewed change before wiring candidate extraction. The main `approve_signal` still refuses pending Sumedh's real guard.

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

## Status
The shared package has executable schemas/fixtures/offline checks; app and module code are now merged separately. Vault and exact approval remain missing on inspected main. Provider/worker work is reported on Adam’s role branch and requires review/integration. Package checks do not establish live deployment or privacy enforcement. C7 is planned, with no executable schema added by this documentation change.
