# Required agent entry point
Read this file before working, including after resuming. Human owners and their coding agents follow the same contracts.

## Read order
README.md → PRD.md → PROJECT_KNOWLEDGE.md → contracts/README.md → docs/PLAN.md → docs/TECH_STACK.md → contracts/specs/*.md → your docs/roles/<role>.md and docs/handoffs/<role>.md → all role update logs.

## Contract-first development
C1 local profile/reflection; C2 presets/recipient assignment; C3 approved disclosure; C4 agent ACK/coordination; C5 nudge/receipt; C6 policy and offline test boundary. Producer/consumer ownership is in contracts/README.md. Import only @kinetic/contracts across workstream boundaries. Do not reach into another owner's internals or duplicate wire types. Build against explicit fixtures/fakes until real adapters exist; never import fakes into production mode.

## Setup and evidence
Run `npm ci` and `npm run check` at the repository root. These verify offline contracts only. Regenerate schemas with `npm run contracts:schema` after shape changes and update fixtures in the same PR. Never claim the application runs from these commands. Record planned, implemented, deployed and live-verified status separately in PROJECT_KNOWLEDGE.md.

## Shared contract visibility
All architecture, API, agent protocol, privacy, acceptance, and data contracts are shared on `main` and available to every teammate and agent. `main` is authoritative; do not maintain branch-specific private contracts. Merge shared contract updates from `main` into each role branch before dependent work. Separate video/presentation planning lives in docs/DEMO.md and is not required engineering-contract reading.

## Selected stack
Kinetic uses Next.js/React/TypeScript, Tailwind/shadcn, SpacetimeDB reducers/private tables/caller-filtered views, Claude, Factory Droid, Cartesia, TypeScript/Zod, and IndexedDB/Web Crypto. Read docs/TECH_STACK.md before choosing dependencies. Never reintroduce server-stored journals or assume a quiz grants disclosure consent.

## Operating rules
- Work only on your role branch. Sync main before integration. Small PRs every 2–3 hours; CS owns integration and does not become the sole implementer.
- Claim files/task in the update area before editing shared surfaces. Own your directories. Ask the affected role before changing shared interfaces; record decisions in docs/DECISIONS.md and version contracts together.
- Contracts are normative proposals, not evidence that protections exist. Never weaken privacy gates to make a feature work. Block uncertain disclosure.
- Journal audio, transcripts, embeddings, inferred sensitive facts, and private summaries must never enter shared agent state, peer prompts, analytics, Git, issues, or agent update files.
- No provider keys in clients or commits. Use synthetic data. No autonomous messages impersonating users. Delivery is in-app; sending a personal message requires user action.
- Verify authentication, ownership, consent scope/version/expiry, pair membership, unlink state, and output allowlists on the server. A prompt is not an authorization boundary.
- No claim of end-to-end encryption, zero provider retention, or guaranteed secrecy from inference without an implemented, verified design.
- Meaningful tests: cross-user access, disclosure/revocation races, injection, payload rejection, end-to-end core journey. Report failures honestly.

## Continuous agent update area
Maintain the dashboard below when a change reaches main. During branch work, append to your own docs/updates/<role>.md (cs, ds, cyber, ai), so four people do not overwrite one file. Read all four logs before starting, before interface changes, and at least every 60 minutes. Push each meaningful handoff. Until merged, readers must inspect the corresponding remote role branch; local files do not magically synchronize across branches.

Update format: UTC timestamp | owner | task | status | branch/commit | files/interfaces changed | verification | next handoff | blockers. Never include personal journal data or credentials. Tag the target role and include exact next action. ACK incoming blockers in your role log. Raise blocked interfaces within 15 minutes.

| Role | Current status | Next handoff |
|---|---|---|
| CS | Planned | Auth, pair model, API skeleton |
| DS | Planned | Three synthetic scenarios, evaluation fixtures |
| Cyber | Planned | Policy validator and ownership tests |
| AI | Planned | Voice adapter and candidate proposal |

## Ownership and handoffs
Use the ownership table in README.md. CS owns SpacetimeDB module plumbing; Cyber owns reusable authorization semantics and reviews the boundary. Shared contract edits need affected producer/consumer review. Before pausing or handing off, update docs/handoffs/<role>.md and your role log with branch/commit, exact interface, evidence, next consumer action and blocker. Refresh PROJECT_KNOWLEDGE.md after significant merges.

## Completion checklist
Contract compatibility, meaningful checks, privacy review for boundary changes, updated role log, reproducible verification instructions. Never mark a stub, replay, or mocked provider as live integration.
