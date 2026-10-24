# Kinetic — persistent project knowledge

## Current product decisions
Voice journaling for partners, friends and family separated by distance. Private raw context persists in an encrypted local vault. Owner-approved minimal signals enable bounded agent coordination and considerate in-app nudges. The quiz is 6–8 questions, skippable, covering communication, support, bandwidth and suggested sharing. Sharing uses partner/friend/family presets only, assigned explicitly to a named person; each item still needs exact approval.

## Selected stack
Next.js/React/TypeScript + Tailwind/shadcn; SpacetimeDB private tables, reducers and caller-filtered views; Claude; Cartesia; Factory Droid in a compatible separate worker; TypeScript/Zod; IndexedDB/Web Crypto; sample .ics schedules, optional Google Calendar OAuth; Vercel plus hosted SpacetimeDB. See docs/TECH_STACK.md.

## Governing rule
The model proposes; explicit consent and deterministic code authorize. Quiz results never create sharing permission. Raw context is never sent to peer agents, shared stores or Factory coordination sessions. Selected audio/text goes to disclosed providers for processing; do not claim cloud-free operation or end-to-end encrypted inference.

## Implementation snapshot
- Product, phases, roles, privacy and onboarding contracts: documented.
- Shared contract package: schemas/types, adapter ports, synthetic fixtures and offline fakes/checks.
- Next.js application, SpacetimeDB module, local encryption, real providers and deployed worker: not implemented here.
- Offline verification: shared TypeScript build, seven generated schemas, 12 contract tests, local document links; current npm audit reports no vulnerabilities. No live provider/application verification or measured usefulness/latency results. Passing offline contracts is not production authorization evidence.
- main is the shared baseline; role branches are work lanes, not isolated specifications. Read current remote branch heads before making claims about other people's work.

## Ownership and next handoff
| Role | Area | First handoff |
|---|---|---|
| CS | UI/API, SpacetimeDB integration, deployment | Authenticated shell + reducer/view stubs |
| DS | Quiz/profile mapping, ranking and evaluation | Quiz/profile fixture + scenario expectations |
| Cyber | Vault, Zod policy, preset/version/revocation, private views | Key design + real authorization signature |
| AI | Claude, Cartesia, Factory worker, bounded exchange | Runtime spike + schema-valid extraction fixture |

Each role keeps docs/updates/<role>.md and docs/handoffs/<role>.md current. Record timestamp, branch/commit, evidence, consumers, blockers and next action. Never journal content or secrets.

## Open decisions and risks
- Event curiosity cards, aura and group matching need prioritized scope and new disclosure contracts.
- Validate worker runtime, provider account access/retention, Cartesia endpoints and Clerk/SpacetimeDB mapping in the first three hours.
- Cyber must finalize vault unlock/key/recovery design; account login does not recover a local key.
- Optional Google OAuth and production authentication polish do not make identity/authorization optional for real data.
- The DS quiz mapping and visual profile must be preference-based, editable and non-diagnostic.

## Maintenance
Refresh this snapshot after a substantive merge; cite real verification and distinguish planned, implemented, deployed and live-verified. Decisions live in docs/DECISIONS.md; requirements in PRD.md; interfaces in contracts/README.md. Video planning stays in docs/DEMO.md.
